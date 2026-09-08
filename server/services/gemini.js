'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { validateCourse, validateLesson, COURSE_RESPONSE_SCHEMA } = require('./schemas');
const { withResilience, deadlineIn, throwIfSettled } = require('./resilience');
const { ConfigurationError } = require('../utils/errors');
const { getProviderConfig } = require('./modelProvider');
const { callDeepSeek } = require('./deepseek');

// Gemini transport defaults. Both providers share one model-stage deadline
// across the first call, its retries and the repair round; modelProvider selects it.
const MODEL_STAGE_TOTAL_MS = 25_000;
const MODEL_ATTEMPT_TIMEOUT_MS = 10_000;
const MODEL_MAX_ATTEMPTS = 3;

// Configurable so a key without access to the default model can use another
// one without a code change.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Constructed lazily, so importing this module has no configuration
// requirement of its own.
let client = null;
function requireApiKey() {
  if (!process.env.GEMINI_API_KEY) {
    // Checked before any attempt starts: a missing key is a configuration
    // problem, not something a retry can fix.
    throw new ConfigurationError('GEMINI_API_KEY is not set');
  }
}

function getModel({ responseSchema } = {}) {
  requireApiKey();
  if (!client) {
    client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return client.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      // Ask the API to emit raw JSON (no markdown fences).
      responseMimeType: 'application/json',
      // Constrained decoding for the course skeleton (defense in depth --
      // Zod validation below still runs regardless). Only the course shape
      // is uniform enough for Gemini's OpenAPI-subset responseSchema; lesson
      // content is a heterogeneous block union it can't express, so that
      // path relies on validate + repair + fallback alone.
      ...(responseSchema ? { responseSchema } : {}),
    },
  });
}

// The default modelCall. Cancellation and the stage deadline come from the
// caller; tests inject a fake with the same (prompt, options) contract so
// they run with no network access.
async function callModel(prompt, { signal, deadlineAt, responseSchema } = {}) {
  if (getProviderConfig().name === 'deepseek') return callDeepSeek(prompt, { signal, deadlineAt });
  requireApiKey();
  return withResilience(
    async (attemptSignal) => {
      const model = getModel({ responseSchema });
      const result = await model.generateContent(prompt, { signal: attemptSignal });
      return result.response.text();
    },
    {
      timeoutMs: MODEL_ATTEMPT_TIMEOUT_MS,
      maxAttempts: MODEL_MAX_ATTEMPTS,
      signal,
      deadlineAt,
    }
  );
}

function parseJSON(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: `Response was not valid JSON: ${err.message}` };
  }
}

// Call the model once, parse, and validate. Never throws on a bad response
// -- returns a typed { ok, errors, raw } result so the caller (below) can
// decide whether to repair, fall back, or succeed.
async function callAndValidate(prompt, modelCall, validate, options = {}) {
  const text = await modelCall(prompt, options);
  const parsed = parseJSON(text);
  if (!parsed.ok) return { ok: false, errors: [parsed.error], raw: text };

  const validated = validate(parsed.value);
  if (!validated.ok) return { ok: false, errors: validated.errors, raw: text };

  return { ok: true, value: validated.value };
}

// Feed the model back its own broken output plus the validation errors and
// ask for corrected JSON -- exactly once, so a stubborn model can't loop the
// caller forever.
function buildRepairPrompt(originalPrompt, brokenOutput, errors) {
  return `${originalPrompt}

Your previous response could not be used. Here is what you returned:
---
${brokenOutput}
---
It failed for these reasons:
${errors.map((e) => `- ${e}`).join('\n')}

Return ONLY corrected JSON that fixes every issue above and matches the required shape exactly. Do not wrap it in markdown or add commentary.`;
}

function buildCoursePrompt(topic) {
  return `You are a curriculum designer. Design a structured course for the topic: "${topic}".

Return ONLY a JSON object with this exact shape:
{
  "title": string,            // course title
  "description": string,      // 1-2 sentence overview
  "tags": string[],           // 3-6 short topic tags
  "modules": [                // 3-6 modules, ordered beginner -> advanced
    {
      "title": string,
      "lessons": string[]     // 3-6 lesson titles (titles only, no content)
    }
  ]
}

Do not include lesson bodies — only lesson titles. Do not wrap the JSON in markdown.`;
}

function buildLessonPrompt(courseTitle, moduleTitle, lessonTitle) {
  return `You are writing one lesson inside a larger course.

Course: "${courseTitle}"
Module: "${moduleTitle}"
Lesson: "${lessonTitle}"

Write the lesson and return ONLY a JSON object with this exact shape:
{
  "title": string,
  "objectives": string[],      // 2-4 learning objectives
  "content": [                 // ordered content blocks
    { "type": "heading", "text": string }
    | { "type": "paragraph", "text": string }
    | { "type": "code", "language": string, "text": string }
    | { "type": "mcq", "question": string, "options": string[], "answer": number, "explanation": string }
  ]
}

Rules:
- "answer" is the ZERO-BASED index into "options" of the correct choice.
- Include at least one heading, two paragraphs, and one mcq.
- Use a "code" block only if the topic is technical.
- Do not wrap the JSON in markdown.`;
}

// A minimal, valid, clearly-labelled course so a request never dead-ends in
// a 500 just because the model rolled badly twice in a row.
function fallbackCourse(topic) {
  return {
    title: `${topic} (draft — generation degraded)`,
    description: 'This course could not be fully generated right now. Try regenerating it.',
    tags: [],
    modules: [
      {
        title: 'Getting started',
        lessons: ['Introduction', 'Overview', 'Next steps'],
      },
    ],
  };
}

function fallbackLesson(lessonTitle) {
  return {
    title: lessonTitle,
    objectives: [],
    content: [
      { type: 'heading', text: lessonTitle },
      { type: 'paragraph', text: 'This lesson could not be generated right now. Please try again.' },
    ],
  };
}

// Public API: call -> validate -> repair once -> safe fallback. A parser or
// schema failure never reaches a caller as an exception; a transport,
// configuration or cancellation failure always does. The distinction is the
// point: invalid model output is recoverable, a dead provider is not.

// Returns { value, outlineStatus }. A transport or configuration failure
// propagates as a typed error -- only invalid model output twice in a row
// produces the labelled fallback outline.
async function generateCourseSafe(topic, { modelCall, signal, deadlineAt } = {}) {
  const call = modelCall || ((prompt, options) => callModel(prompt, { ...options, responseSchema: COURSE_RESPONSE_SCHEMA }));
  const prompt = buildCoursePrompt(topic);
  // Created once, here: both rounds share it.
  const stage = { signal, deadlineAt: deadlineIn(getProviderConfig().stageMs, deadlineAt) };
  throwIfSettled(stage.signal, stage.deadlineAt);

  const first = await callAndValidate(prompt, call, validateCourse, stage);
  if (first.ok) return { value: first.value, outlineStatus: 'ready' };

  // A cancelled or exhausted stage never starts the repair round, and never
  // turns into a fallback: the fallback is for invalid model output alone.
  throwIfSettled(stage.signal, stage.deadlineAt);

  const repairPrompt = buildRepairPrompt(prompt, first.raw ?? '', first.errors);
  const repaired = await callAndValidate(repairPrompt, call, validateCourse, stage);
  if (repaired.ok) return { value: repaired.value, outlineStatus: 'ready' };

  console.error('[generation] course outline failed validation twice; using the fallback outline.');
  return { value: fallbackCourse(topic), outlineStatus: 'degraded' };
}

// Returns { value, generationStatus }, using the same rule: ready for
// validated model output, degraded only for the local fallback body.
async function generateLessonSafe(courseTitle, moduleTitle, lessonTitle, { modelCall, signal, deadlineAt } = {}) {
  const call = modelCall || ((prompt, options) => callModel(prompt, options));
  const prompt = buildLessonPrompt(courseTitle, moduleTitle, lessonTitle);
  const stage = { signal, deadlineAt: deadlineIn(getProviderConfig().stageMs, deadlineAt) };
  throwIfSettled(stage.signal, stage.deadlineAt);

  const first = await callAndValidate(prompt, call, validateLesson, stage);
  if (first.ok) return { value: first.value, generationStatus: 'ready' };

  // A cancelled or exhausted stage never starts the repair round, and never
  // turns into a fallback: the fallback is for invalid model output alone.
  throwIfSettled(stage.signal, stage.deadlineAt);

  const repairPrompt = buildRepairPrompt(prompt, first.raw ?? '', first.errors);
  const repaired = await callAndValidate(repairPrompt, call, validateLesson, stage);
  if (repaired.ok) return { value: repaired.value, generationStatus: 'ready' };

  console.error('[generation] lesson content failed validation twice; using the fallback lesson.');
  return { value: fallbackLesson(lessonTitle), generationStatus: 'degraded' };
}

module.exports = {
  generateCourseSafe,
  generateLessonSafe,
  MODEL_STAGE_TOTAL_MS,
  MODEL_ATTEMPT_TIMEOUT_MS,
  MODEL_MAX_ATTEMPTS,
  // Re-exported for callers that validate without generating:
  validateCourse,
  validateLesson,
};
