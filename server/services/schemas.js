'use strict';

// ============================================================================
// LEARNING CHECKPOINT #1 — LLM structured-output contract
// ----------------------------------------------------------------------------
// Single source of truth for what a valid course / lesson looks like. Used
// both to validate Gemini's output (defense in depth) and, for the course
// shape, fed to Gemini's `responseSchema` for constrained decoding
// (prevention). See LEARNING.md (Checkpoint 1).
// ============================================================================

const { z } = require('zod');

const ContentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string().min(1) }),
  z.object({ type: z.literal('paragraph'), text: z.string().min(1) }),
  z.object({ type: z.literal('code'), language: z.string().optional().default(''), text: z.string().min(1) }),
  z.object({
    type: z.literal('mcq'),
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(6),
    answer: z.number().int().min(0),
    explanation: z.string().optional().default(''),
  }).refine((block) => block.answer < block.options.length, {
    message: 'answer must be a valid zero-based index into options',
    path: ['answer'],
  }),
]);

const ModuleSkeletonSchema = z.object({
  title: z.string().min(1),
  // The contract: each module has 3-6 lesson titles. A module with zero (or
  // 1-2) lessons is invalid, not just "sparse".
  lessons: z.array(z.string().min(1)).min(3).max(6),
});

const CourseSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  tags: z.array(z.string()).optional().default([]),
  modules: z.array(ModuleSkeletonSchema).min(1).max(6),
});

const LessonSchema = z.object({
  title: z.string().min(1),
  objectives: z.array(z.string()).optional().default([]),
  content: z.array(ContentBlockSchema).min(1),
});

// The Gemini API's `responseSchema` only supports a small OpenAPI subset
// (no oneOf/discriminated unions), so it's only practical for the course
// skeleton's uniform shape -- not the heterogeneous lesson content-block
// union. The lesson side relies on validate + repair + fallback alone.
const COURSE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    modules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          lessons: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'lessons'],
      },
    },
  },
  required: ['title', 'modules'],
};

function formatIssues(error) {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

// Pure validators: parse-or-report, never throw. `validateCourse`/
// `validateLesson` return { ok: true, value } or { ok: false, errors }.
function validateCourse(obj) {
  const result = CourseSchema.safeParse(obj);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, errors: formatIssues(result.error) };
}

function validateLesson(obj) {
  const result = LessonSchema.safeParse(obj);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, errors: formatIssues(result.error) };
}

module.exports = {
  CourseSchema,
  LessonSchema,
  ContentBlockSchema,
  COURSE_RESPONSE_SCHEMA,
  validateCourse,
  validateLesson,
};
