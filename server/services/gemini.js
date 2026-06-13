const { GoogleGenerativeAI } = require('@google/generative-ai');

// The model id is configurable so you can swap it without touching code.
// If your key doesn't have access to this model, set GEMINI_MODEL in .env.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Lazily construct the client so a missing key only fails when generation is
// actually attempted (not at server boot), and the error message is clear.
let client = null;
function getModel() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set — add it to server/.env');
  }
  if (!client) {
    client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return client.getGenerativeModel({
    model: MODEL,
    // Ask the API to emit raw JSON (no markdown fences) so JSON.parse can
    // consume the response directly.
    generationConfig: { responseMimeType: 'application/json' },
  });
}

// Single place where the model is called and its text response is turned into
// an object. Everything below funnels through here.
async function generateJSON(prompt) {
  const model = getModel();
  const result = await model.generateContent(prompt);
  const text = result.response.text();

  // LEARNING CHECKPOINT #1 — LLM structured-output contract & repair.
  // Naive behaviour: trust the model, parse, and throw if it isn't valid JSON.
  // There is no schema validation, no repair re-prompt, and no fallback here.
  // See LEARNING.md (Checkpoint 1) for what to build and why this is fragile.
  return JSON.parse(text);
}

async function generateCourse(topic) {
  const prompt = `You are a curriculum designer. Design a structured course for the topic: "${topic}".

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

  return generateJSON(prompt);
}

async function generateLesson(courseTitle, moduleTitle, lessonTitle) {
  const prompt = `You are writing one lesson inside a larger course.

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

  return generateJSON(prompt);
}

module.exports = { generateCourse, generateLesson };
