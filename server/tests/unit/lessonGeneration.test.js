'use strict';

// The shared generate-and-persist path used by both the single-lesson route
// and the bulk stream.

const test = require('node:test');
const assert = require('node:assert');

const { createLessonGenerator } = require('../../services/lessonGeneration');

function fakeLesson(overrides = {}) {
  return {
    _id: 'lesson-1',
    title: 'Ownership',
    objectives: [],
    content: [],
    videos: [],
    isEnriched: false,
    saves: 0,
    async save() { this.saves += 1; return this; },
    ...overrides,
  };
}

function readyGeneration(generationStatus = 'ready') {
  return async () => ({
    value: {
      title: 'Ownership',
      objectives: ['Understand ownership'],
      content: [{ type: 'paragraph', text: 'Generated body.' }],
    },
    generationStatus,
  });
}

const noVideos = async () => ({ videos: [], enrichmentStatus: 'no_key' });

test('valid model output persists as ready', async () => {
  const generator = createLessonGenerator({
    generateLessonSafe: readyGeneration(),
    searchVideos: noVideos,
  });
  const lesson = fakeLesson();

  const { lesson: saved, skipped } = await generator.generateAndPersistLesson({
    lesson, courseTitle: 'Rust', moduleTitle: 'Basics',
  });

  assert.equal(skipped, false);
  assert.equal(saved.generationStatus, 'ready');
  assert.equal(saved.enrichmentStatus, 'no_key');
  assert.equal(saved.isEnriched, true);
  assert.equal(saved.saves, 1, 'exactly one write, never an intermediate content-only save');
});

test('a fallback body persists as degraded and stays retryable', async () => {
  const generator = createLessonGenerator({
    generateLessonSafe: readyGeneration('degraded'),
    searchVideos: noVideos,
  });
  const lesson = fakeLesson();

  const { lesson: saved } = await generator.generateAndPersistLesson({
    lesson, courseTitle: 'Rust', moduleTitle: 'Basics',
  });
  assert.equal(saved.generationStatus, 'degraded');

  // A degraded lesson has non-empty content, but must still be regenerated
  // by an ordinary (force:false) retry.
  let secondCall = 0;
  const retry = createLessonGenerator({
    generateLessonSafe: async (...args) => { secondCall += 1; return readyGeneration()(...args); },
    searchVideos: noVideos,
  });
  const result = await retry.generateAndPersistLesson({
    lesson: saved, courseTitle: 'Rust', moduleTitle: 'Basics',
  });
  assert.equal(secondCall, 1);
  assert.equal(result.skipped, false);
  assert.equal(result.lesson.generationStatus, 'ready');
});

test('a ready lesson is skipped without any upstream call or write', async () => {
  let modelCalls = 0;
  let searchCalls = 0;
  const generator = createLessonGenerator({
    generateLessonSafe: async (...args) => { modelCalls += 1; return readyGeneration()(...args); },
    searchVideos: async () => { searchCalls += 1; return noVideos(); },
  });
  const lesson = fakeLesson({
    generationStatus: 'ready',
    content: [{ type: 'paragraph', text: 'Already written.' }],
  });

  const { skipped } = await generator.generateAndPersistLesson({
    lesson, courseTitle: 'Rust', moduleTitle: 'Basics',
  });

  assert.equal(skipped, true);
  assert.equal(modelCalls, 0);
  assert.equal(searchCalls, 0);
  assert.equal(lesson.saves, 0);
});

test('force replaces a ready lesson, but only after the replacement is ready', async () => {
  const generator = createLessonGenerator({
    generateLessonSafe: readyGeneration(),
    searchVideos: noVideos,
  });
  const lesson = fakeLesson({
    generationStatus: 'ready',
    content: [{ type: 'paragraph', text: 'Old body.' }],
  });

  const { skipped, lesson: saved } = await generator.generateAndPersistLesson({
    lesson, courseTitle: 'Rust', moduleTitle: 'Basics', force: true,
  });

  assert.equal(skipped, false);
  assert.equal(saved.content[0].text, 'Generated body.');
  assert.equal(saved.saves, 1);
});

test('a legacy lesson with no stored status is regenerated, not skipped', async () => {
  const generator = createLessonGenerator({
    generateLessonSafe: readyGeneration(),
    searchVideos: noVideos,
  });
  const lesson = fakeLesson({ content: [], generationStatus: undefined });

  const { skipped } = await generator.generateAndPersistLesson({
    lesson, courseTitle: 'Rust', moduleTitle: 'Basics',
  });
  assert.equal(skipped, false);
});

test('a generation failure leaves previously persisted content intact', async () => {
  const generator = createLessonGenerator({
    generateLessonSafe: async () => { throw new Error('upstream exhausted'); },
    searchVideos: noVideos,
  });
  const lesson = fakeLesson({
    generationStatus: 'degraded',
    content: [{ type: 'paragraph', text: 'Fallback body.' }],
  });

  await assert.rejects(() => generator.generateAndPersistLesson({
    lesson, courseTitle: 'Rust', moduleTitle: 'Basics',
  }));

  assert.equal(lesson.generationStatus, 'degraded');
  assert.equal(lesson.content[0].text, 'Fallback body.');
  assert.equal(lesson.saves, 0, 'no compensating "failed" document is written');
});

test('an enrichment outcome is recorded alongside the generated body', async () => {
  const generator = createLessonGenerator({
    generateLessonSafe: readyGeneration(),
    searchVideos: async () => ({ videos: [], enrichmentStatus: 'unavailable' }),
  });
  const lesson = fakeLesson();

  const { lesson: saved } = await generator.generateAndPersistLesson({
    lesson, courseTitle: 'Rust', moduleTitle: 'Basics',
  });

  assert.equal(saved.generationStatus, 'ready', 'YouTube being down does not degrade the lesson');
  assert.equal(saved.enrichmentStatus, 'unavailable');
  assert.equal(saved.isEnriched, true);
});
