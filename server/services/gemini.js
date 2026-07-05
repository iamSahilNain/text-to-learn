'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { validateCourse, validateLesson, COURSE_RESPONSE_SCHEMA } = require('./schemas');
const { withResilience } = require('./resilience');

// The model id is configurable so you can swap it without touching code.
// If your key doesn't have access to this model, set GEMINI_MODEL in .env.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Lazily construct the client so a missing key only fails when generation is
// actually attempted (not at server boot), and the error message is clear.
let client = null;
function getModel({ responseSchema } = {}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set — add it to server/.env');
  }
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

// ============================================================================
// LEARNING CHECKPOINT #2 — External-API resilience.
// One real attempt at calling the model, wrapped with a timeout + retry +
// backoff + 429-vs-5xx policy (services/resilience.js). This is the
// `modelCall` generateCourseSafe/generateLessonSafe use by default; tests
// inject a fake in its place so they run with zero network access.
// ============================================================================
async function callModel(prompt, { responseSchema } = {}) {
  return withResilience(
    async (signal) => {
      const model = getModel({ responseSchema });
      const result = await model.generateContent(prompt, { signal });
      return result.response.text();
    },
    { timeoutMs: 20_000, maxAttempts: 3 }
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
async function callAndValidate(prompt, modelCall, validate) {
  const text = await modelCall(prompt);
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

// ============================================================================
// LEARNING CHECKPOINT #1 — LLM structured-output contract & repair.
// Public API: call -> validate -> (on failure) repair once -> (on failure)
// safe fallback. Never leaks a raw JSON.parse SyntaxError or a Zod error to
// the caller (courseController / lessonRoutes) -- they only ever see a
// valid object.
// ============================================================================

async function generateCourseSafe(topic, { modelCall } = {}) {
  const call = modelCall || ((prompt) => callModel(prompt, { responseSchema: COURSE_RESPONSE_SCHEMA }));
  const prompt = buildCoursePrompt(topic);

  const first = await callAndValidate(prompt, call, validateCourse);
  if (first.ok) return first.value;

  const repairPrompt = buildRepairPrompt(prompt, first.raw ?? '', first.errors);
  const repaired = await callAndValidate(repairPrompt, call, validateCourse);
  if (repaired.ok) return repaired.value;

  console.error('[gemini] generateCourseSafe: repair failed, returning fallback course.', repaired.errors);
  return fallbackCourse(topic);
}

async function generateLessonSafe(courseTitle, moduleTitle, lessonTitle, { modelCall } = {}) {
  const call = modelCall || ((prompt) => callModel(prompt));
  const prompt = buildLessonPrompt(courseTitle, moduleTitle, lessonTitle);

  const first = await callAndValidate(prompt, call, validateLesson);
  if (first.ok) return first.value;

  const repairPrompt = buildRepairPrompt(prompt, first.raw ?? '', first.errors);
  const repaired = await callAndValidate(repairPrompt, call, validateLesson);
  if (repaired.ok) return repaired.value;

  console.error('[gemini] generateLessonSafe: repair failed, returning fallback lesson.', repaired.errors);
  return fallbackLesson(lessonTitle);
}

module.exports = {
  generateCourseSafe,
  generateLessonSafe,
  // Exported for the checkpoint 1 unit tests (pure, no network):
  validateCourse,
  validateLesson,
};
