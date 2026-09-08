'use strict';

// The generation contract: what counts as a valid course and lesson before
// anything is persisted.

const test = require('node:test');
const assert = require('node:assert');

const { validateCourse, validateLesson } = require('../../services/schemas');

test('a course missing its required fields is rejected', () => {
  assert.equal(validateCourse({ description: 'x' }).ok, false);
  assert.equal(validateCourse({ title: 'Only a title' }).ok, false);
});

test('a module with too few lesson titles is rejected, not merely sparse', () => {
  const result = validateCourse({
    title: 'Intro to Testing',
    modules: [{ title: 'Module 1', lessons: [] }],
  });
  assert.equal(result.ok, false);

  assert.equal(validateCourse({
    title: 'Intro to Testing',
    modules: [{ title: 'Module 1', lessons: ['One', 'Two'] }],
  }).ok, false);

  assert.equal(validateCourse({
    title: 'Intro to Testing',
    modules: [{ title: 'Module 1', lessons: ['One', 'Two', 'Three'] }],
  }).ok, true);
});

test('a valid course reports its own errors as readable paths', () => {
  const result = validateCourse({ title: '', modules: [] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.every((entry) => typeof entry === 'string' && entry.includes(':')));
});

test('an MCQ answer must index into its own options', () => {
  const lesson = (answer, options) => ({
    title: 'Ownership',
    content: [{ type: 'mcq', question: 'Who owns it?', options, answer, explanation: '' }],
  });

  assert.equal(validateLesson(lesson(0, ['a', 'b'])).ok, true);
  assert.equal(validateLesson(lesson(1, ['a', 'b'])).ok, true);
  // Out of range: a renderer would mark no option correct, and the quiz
  // would be silently unanswerable.
  assert.equal(validateLesson(lesson(2, ['a', 'b'])).ok, false);
  assert.equal(validateLesson(lesson(-1, ['a', 'b'])).ok, false);
  assert.equal(validateLesson(lesson(0.5, ['a', 'b'])).ok, false);
});

test('a lesson needs at least one content block', () => {
  assert.equal(validateLesson({ title: 'Ownership', content: [] }).ok, false);
  assert.equal(validateLesson({
    title: 'Ownership',
    content: [{ type: 'paragraph', text: 'Body.' }],
  }).ok, true);
});

test('an unknown block type is rejected', () => {
  assert.equal(validateLesson({
    title: 'Ownership',
    content: [{ type: 'video', url: 'https://example.test' }],
  }).ok, false);
});

test('optional fields are filled in with their defaults', () => {
  const result = validateLesson({
    title: 'Ownership',
    content: [{ type: 'code', text: 'let x = 1;' }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.objectives, []);
  assert.equal(result.value.content[0].language, '');
});
