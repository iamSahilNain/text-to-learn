'use strict';

// ============================================================================
// LEARNING CHECKPOINT #1 — LLM structured-output contract & repair
// ----------------------------------------------------------------------------
// Activated: services/gemini.js now validates every Gemini response against
// a Zod schema (services/schemas.js), issues exactly one repair re-prompt on
// failure, and falls back to a minimal, valid, labelled course rather than
// throwing. These tests exercise that contract with an injected `modelCall`
// so they run with zero network access.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');

const { validateCourse, generateCourseSafe } = require('../services/gemini');

test('validateCourse rejects an object missing required fields', () => {
  // A course with no title / no modules must be rejected by the schema
  // validator BEFORE it ever reaches Mongo.
  const result = validateCourse({ description: 'x' });
  assert.equal(result.ok, false);
});

test('validateCourse rejects modules that contain zero lessons', () => {
  // The contract says each module has 3-6 lessons. Empty modules are invalid.
  const result = validateCourse({
    title: 'Intro to Testing',
    modules: [{ title: 'Module 1', lessons: [] }],
  });
  assert.equal(result.ok, false);
});

test('generateCourseSafe repairs a single malformed JSON response', async () => {
  let calls = 0;
  const validCourse = {
    title: 'Intro to Testing',
    description: 'Learn how to write good tests.',
    tags: ['testing'],
    modules: [{ title: 'Basics', lessons: ['One', 'Two', 'Three'] }],
  };
  // First call returns invalid/truncated JSON; second (the repair) is valid.
  const modelCall = async () => {
    calls += 1;
    if (calls === 1) return '{ this is not valid JSON';
    return JSON.stringify(validCourse);
  };

  const result = await generateCourseSafe('testing', { modelCall });

  assert.equal(calls, 2, 'expected exactly one repair re-prompt (2 total calls)');
  assert.equal(validateCourse(result).ok, true);
  assert.equal(result.title, validCourse.title);
});

test('generateCourseSafe returns a safe fallback when repair also fails', async () => {
  let calls = 0;
  // Garbage on both the original call and the repair attempt.
  const modelCall = async () => {
    calls += 1;
    return 'not json at all, still not json';
  };

  const result = await generateCourseSafe('testing', { modelCall });

  assert.equal(calls, 2, 'expected exactly one repair attempt before falling back');
  assert.equal(validateCourse(result).ok, true, 'the fallback course must itself be valid/renderable');
});

test('generateCourseSafe never leaks a raw JSON.parse SyntaxError', async () => {
  // The caller (courseController) should only ever see either a valid course
  // object or a typed, intentional error — never a raw parser exception.
  const modelCall = async () => '{{{ garbage';
  await assert.doesNotReject(() => generateCourseSafe('testing', { modelCall }));
});
