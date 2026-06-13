'use strict';

// ============================================================================
// LEARNING CHECKPOINT #1 — LLM structured-output contract & repair
// ----------------------------------------------------------------------------
// These tests are SKIPPED on purpose. They describe the hardened behaviour you
// should build in server/services/gemini.js. Today that file does a naive
// JSON.parse and throws on anything malformed.
//
// To activate a test: remove its `{ skip: ... }` option and implement the
// behaviour it asserts. The function names below (validateCourse,
// generateCourseSafe, etc.) are SUGGESTED — design the real API yourself.
// See LEARNING.md → Checkpoint 1 for hints and reading.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');

const SKIP = { skip: 'LEARNING CHECKPOINT #1 — implement in services/gemini.js' };

test('validateCourse rejects an object missing required fields', SKIP, () => {
  // A course with no title / no modules must be rejected by your schema
  // validator BEFORE it ever reaches Mongo.
  // const result = validateCourse({ description: 'x' });
  // assert.equal(result.ok, false);
  assert.fail('not implemented');
});

test('validateCourse rejects modules that contain zero lessons', SKIP, () => {
  // The contract says each module has 3-6 lessons. Empty modules are invalid.
  assert.fail('not implemented');
});

test('generateCourseSafe repairs a single malformed JSON response', SKIP, () => {
  // Given a model that returns invalid/truncated JSON on the first call and
  // valid JSON on the second, your code should issue exactly ONE repair
  // re-prompt and then succeed. Assert the second result validates.
  assert.fail('not implemented');
});

test('generateCourseSafe returns a safe fallback when repair also fails', SKIP, () => {
  // If the model returns garbage twice, do NOT throw raw to the caller.
  // Return a minimal, valid, clearly-labelled fallback course so the request
  // still produces something renderable.
  assert.fail('not implemented');
});

test('generateCourseSafe never leaks a raw JSON.parse SyntaxError', SKIP, () => {
  // The caller (courseController) should only ever see either a valid course
  // object or a typed, intentional error — never a raw parser exception.
  assert.fail('not implemented');
});
