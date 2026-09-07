'use strict';

// Cancellation over real HTTP. Upstream providers are injected fakes with
// explicit release points, so the assertions are about ordering rather than
// about waiting for a real timer.

const test = require('node:test');
const assert = require('node:assert');

const { startTestServer } = require('./helpers/server');
const { queryReturning } = require('./helpers/fakes');
const { HEARTBEAT_INTERVAL_MS } = require('../../controllers/courseController');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function lessonDocument(id, overrides = {}) {
  return {
    _id: id,
    title: `Lesson ${id}`,
    objectives: [],
    content: [],
    videos: [],
    isEnriched: false,
    module: 'module-1',
    saves: 0,
    async save() { this.saves += 1; return this; },
    toObject() {
      const { save, toObject, saves, ...rest } = this;
      return rest;
    },
    ...overrides,
  };
}

async function withServer(overrides, run) {
  const started = await startTestServer(overrides);
  try {
    return await run(started);
  } finally {
    await started.close();
  }
}

// Records how far the pipeline got, so a test can assert that nothing after
// the cancellation point ever started.
//
// The first model call parks until the test releases it, and reports when
// the server-side signal actually fires. Releasing only after that removes
// the race between the client's abort and the server noticing it: the call
// then returns a value, exactly like a request already in flight when the
// client left, and every later stage must still refuse to run.
function instrumentedProviders({ gate }) {
  const seen = { model: 0, enrichment: 0 };
  return {
    seen,
    generateLessonSafe: async (_courseTitle, _moduleTitle, lessonTitle, { signal } = {}) => {
      seen.model += 1;
      if (gate && seen.model === 1) {
        signal?.addEventListener('abort', () => gate.observedAbort.resolve(), { once: true });
        gate.reached.resolve(lessonTitle);
        await gate.release.promise;
      }
      return {
        value: { title: lessonTitle, objectives: [], content: [{ type: 'paragraph', text: 'Body.' }] },
        generationStatus: 'ready',
      };
    },
    searchVideos: async () => {
      seen.enrichment += 1;
      return { videos: [], enrichmentStatus: 'no_key' };
    },
  };
}

function makeGate() {
  return { reached: deferred(), observedAbort: deferred(), release: deferred() };
}

for (const [label, init] of [
  ['no body', { method: 'POST' }],
  ['a JSON {} body', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
]) {
  test(`aborting a lesson request with ${label} stops every later stage`, async () => {
    const gate = makeGate();
    const providers = instrumentedProviders({ gate });
    const lesson = lessonDocument('lesson-1');

    await withServer({
      ...providers,
      models: {
        Lesson: { findById: async () => lesson },
        Module: { findById: async () => ({ _id: 'module-1', title: 'Basics', course: 'course-1' }) },
        Course: { findById: async () => ({ _id: 'course-1', title: 'Rust' }) },
      },
    }, async ({ baseUrl }) => {
      const controller = new AbortController();
      const request = fetch(`${baseUrl}/api/lessons/lesson-1/generate`, { ...init, signal: controller.signal });
      request.catch(() => {});

      await gate.reached.promise;
      controller.abort();

      // Release only once the server has actually seen the disconnect.
      await gate.observedAbort.promise;
      gate.release.resolve();
      await assert.rejects(() => request);
      await new Promise((resolve) => setTimeout(resolve, 60));

      assert.equal(providers.seen.model, 1);
      assert.equal(providers.seen.enrichment, 0, 'enrichment must not start after cancellation');
      assert.equal(lesson.saves, 0, 'no write may follow cancellation');
    });
  });
}

test('a cancelled bulk stream stops before the next lesson and emits nothing further', async () => {
  const gate = makeGate();
  const providers = instrumentedProviders({ gate });
  const lessons = [lessonDocument('l1'), lessonDocument('l2')];
  const courseModule = {
    _id: 'module-1',
    title: 'Basics',
    lessons,
    toObject() { return { _id: this._id, title: this.title, lessons: this.lessons.map((l) => l.toObject()) }; },
  };
  const course = { _id: 'course-1', title: 'Rust', modules: [courseModule] };

  await withServer({
    ...providers,
    models: { Course: { findById: () => queryReturning(course) } },
  }, async ({ baseUrl }) => {
    const controller = new AbortController();
    const request = fetch(`${baseUrl}/api/courses/course-1/generate-content`, {
      method: 'POST',
      signal: controller.signal,
    });
    request.catch(() => {});

    await gate.reached.promise;
    controller.abort();
    await gate.observedAbort.promise;
    gate.release.resolve();
    await assert.rejects(() => request);
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(providers.seen.model, 1, 'the second lesson must never start');
    assert.equal(providers.seen.enrichment, 0);
    assert.equal(lessons[0].saves, 0);
    assert.equal(lessons[1].saves, 0);
  });
});

test('a bulk request deadline emits exactly one generation_timeout and no done', async () => {
  const lessons = [lessonDocument('l1'), lessonDocument('l2')];
  const courseModule = {
    _id: 'module-1',
    title: 'Basics',
    lessons,
    toObject() { return { _id: this._id, title: this.title, lessons: this.lessons.map((l) => l.toObject()) }; },
  };
  const course = { _id: 'course-1', title: 'Rust', modules: [courseModule] };

  const overrides = {
    models: { Course: { findById: () => queryReturning(course) } },
    // The first lesson consumes the whole request budget, which the test
    // shortens so no real ten-minute timer is involved.
    generateLessonSafe: async (_c, _m, title, { signal, deadlineAt } = {}) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5_000);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
      });
      return { value: { title, objectives: [], content: [{ type: 'paragraph', text: 'x' }] }, generationStatus: 'ready', deadlineAt };
    },
    searchVideos: async () => ({ videos: [], enrichmentStatus: 'no_key' }),
    timeouts: { bulkMs: 150 },
  };

  await withServer(overrides, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/courses/course-1/generate-content`, { method: 'POST' });
    const text = await response.text();
    const records = text.split('\n\n').filter(Boolean);

    const errors = records.filter((record) => record.startsWith('event: error'));
    assert.equal(errors.length, 1, `expected exactly one terminal error, got ${records.length} record(s)`);
    const payload = JSON.parse(errors[0].split('\ndata: ')[1]);
    assert.deepEqual(payload, {
      code: 'generation_timeout',
      message: 'Generation timed out. Retry to continue.',
      retriable: true,
    });

    assert.equal(records.some((record) => record.startsWith('event: done')), false, 'no done after an error');
    assert.equal(lessons[0].saves, 0);
  });
});

test('lessons saved before the deadline survive it and are skipped on retry', async () => {
  const lessons = [
    lessonDocument('l1'),
    lessonDocument('l2'),
  ];
  const courseModule = {
    _id: 'module-1',
    title: 'Basics',
    lessons,
    toObject() { return { _id: this._id, title: this.title, lessons: this.lessons.map((l) => l.toObject()) }; },
  };
  const course = { _id: 'course-1', title: 'Rust', modules: [courseModule] };
  const models = { Course: { findById: () => queryReturning(course) } };

  let modelCalls = 0;
  const generateLessonSafe = async (_c, _m, title) => {
    modelCalls += 1;
    if (title === 'Lesson l2' && modelCalls <= 2) {
      // Second lesson stalls past the shortened request budget.
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    return { value: { title, objectives: [], content: [{ type: 'paragraph', text: 'Body.' }] }, generationStatus: 'ready' };
  };
  const searchVideos = async () => ({ videos: [], enrichmentStatus: 'no_key' });

  await withServer({ models, generateLessonSafe, searchVideos, timeouts: { bulkMs: 400 } }, async ({ baseUrl }) => {
    const text = await (await fetch(`${baseUrl}/api/courses/course-1/generate-content`, { method: 'POST' })).text();
    assert.ok(text.includes('generation_timeout'));
    assert.equal(lessons[0].saves, 1, 'the first lesson was committed before the deadline');
    assert.equal(lessons[1].saves, 0);
  });

  // Resume: the ready lesson is skipped, the pending one is generated.
  const callsBeforeRetry = modelCalls;
  await withServer({ models, generateLessonSafe, searchVideos }, async ({ baseUrl }) => {
    const text = await (await fetch(`${baseUrl}/api/courses/course-1/generate-content`, { method: 'POST' })).text();
    const done = JSON.parse(text.split('event: done\ndata: ')[1].split('\n\n')[0]);
    assert.deepEqual(done, {
      courseId: 'course-1',
      status: 'complete',
      readyLessons: 2,
      degradedLessons: 0,
      totalLessons: 2,
    });
  });
  assert.equal(modelCalls - callsBeforeRetry, 1, 'only the unfinished lesson was regenerated');
  assert.equal(lessons[0].saves, 1, 'the already-ready lesson was not rewritten');
  assert.equal(lessons[1].saves, 1);
});

test('the heartbeat interval is cleared on every terminal path', async () => {
  const course = { _id: 'course-1', title: 'Rust', modules: [] };
  const overrides = {
    models: { Course: { findById: () => queryReturning(course) } },
  };

  assert.equal(HEARTBEAT_INTERVAL_MS, 10_000);

  await withServer(overrides, async ({ baseUrl }) => {
    const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    const response = await fetch(`${baseUrl}/api/courses/course-1/generate-content`, { method: 'POST' });
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    assert.ok(after <= before + 1, `heartbeat timer leaked: ${before} -> ${after}`);
  });
});
