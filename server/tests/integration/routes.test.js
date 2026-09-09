'use strict';

// Real Express over loopback with injected models and upstream providers.
// No database and no network: these tests are about route semantics.

const test = require('node:test');
const assert = require('node:assert');

const { startTestServer } = require('./helpers/server');
const { queryReturning } = require('./helpers/fakes');

function lessonDocument(overrides = {}) {
  return {
    _id: 'lesson-1',
    title: 'Ownership',
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

// Minimal stand-ins for the Mongoose model surface the routes actually use.
// Chainable (via queryReturning) so a handler that adds .select/.maxTimeMS
// keeps working here exactly as a real Mongoose Query would -- awaiting the
// return value resolves the same way whether or not anything chained off it.
function fakeModels({ lesson, courseModule, course }) {
  return {
    Lesson: { findById: (id) => queryReturning(lesson && String(lesson._id) === String(id) ? lesson : null) },
    Module: { findById: (id) => queryReturning(courseModule && String(courseModule._id) === String(id) ? courseModule : null) },
    Course: { findById: (id) => queryReturning(course && String(course._id) === String(id) ? course : null) },
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

test('GET /api/lessons/:id returns an effective status for a legacy lesson', async () => {
  const lesson = lessonDocument({ content: [{ type: 'paragraph', text: 'Real content.' }] });
  await withServer({ models: fakeModels({ lesson }) }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/lessons/lesson-1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.generationStatus, 'ready');
    assert.equal(body.enrichmentStatus, 'pending');
  });
});

test('GET /api/lessons/:id carries the lesson\'s courseId, derived from its module', async () => {
  const lesson = lessonDocument({ content: [{ type: 'paragraph', text: 'Real content.' }] });
  const overrides = {
    models: fakeModels({
      lesson,
      courseModule: { _id: 'module-1', title: 'Basics', course: 'course-1' },
      course: { _id: 'course-1', title: 'Rust' },
    }),
  };
  await withServer(overrides, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/lessons/lesson-1`);
    const body = await response.json();
    assert.equal(body.courseId, 'course-1');
    // The existing module reference is untouched by the addition.
    assert.equal(body.module, 'module-1');
  });
});

test('GET /api/lessons/:id looks up the module with a field-limited, time-bounded query', async () => {
  const lesson = lessonDocument({ content: [{ type: 'paragraph', text: 'Real content.' }] });
  let selectArg;
  let maxTimeArg;
  const models = {
    Lesson: { findById: async (id) => (String(lesson._id) === String(id) ? lesson : null) },
    Module: {
      findById: (id) => ({
        select(fields) { selectArg = fields; return this; },
        maxTimeMS(ms) { maxTimeArg = ms; return this; },
        then(resolve) { resolve(String(id) === 'module-1' ? { _id: 'module-1', course: 'course-1' } : null); },
      }),
    },
    Course: { findById: async () => null },
  };

  await withServer({ models }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/lessons/lesson-1`);
    const body = await response.json();
    assert.equal(body.courseId, 'course-1');
    assert.equal(selectArg, 'course');
    assert.equal(typeof maxTimeArg, 'number');
    assert.ok(maxTimeArg > 0);
  });
});

test('GET /api/lessons/:id omits courseId when the lesson\'s module cannot be found', async () => {
  const lesson = lessonDocument({ content: [{ type: 'paragraph', text: 'Real content.' }] });
  await withServer({ models: fakeModels({ lesson }) }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/lessons/lesson-1`);
    const body = await response.json();
    assert.equal('courseId' in body, false);
  });
});

test('GET /api/lessons/:id reports a missing lesson as 404', async () => {
  await withServer({ models: fakeModels({}) }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/lessons/lesson-1`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: { code: 'not_found', message: 'Lesson not found' },
    });
  });
});

test('POST /api/lessons/:id/generate works with no body and with {}', async () => {
  for (const init of [{ method: 'POST' }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }]) {
    const lesson = lessonDocument();
    const overrides = {
      models: fakeModels({
        lesson,
        courseModule: { _id: 'module-1', title: 'Basics', course: 'course-1' },
        course: { _id: 'course-1', title: 'Rust' },
      }),
      generateLessonSafe: async () => ({
        value: { title: 'Ownership', objectives: ['Learn it'], content: [{ type: 'paragraph', text: 'Body.' }] },
        generationStatus: 'ready',
      }),
      searchVideos: async () => ({ videos: [], enrichmentStatus: 'no_key' }),
    };

    await withServer(overrides, async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/lessons/lesson-1/generate`, init);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.generationStatus, 'ready');
      assert.equal(lesson.saves, 1);
    });
  }
});

test('POST /api/lessons/:id/generate carries courseId, so a client replacing its lesson with this response keeps its parent link', async () => {
  const pending = lessonDocument();
  const degraded = lessonDocument({
    generationStatus: 'degraded',
    content: [{ type: 'paragraph', text: 'Fallback body.' }],
  });

  for (const lesson of [pending, degraded]) {
    const overrides = {
      models: fakeModels({
        lesson,
        courseModule: { _id: 'module-1', title: 'Basics', course: 'course-1' },
        course: { _id: 'course-1', title: 'Rust' },
      }),
      generateLessonSafe: async () => ({
        value: { title: 'Ownership', objectives: [], content: [{ type: 'paragraph', text: 'Fresh body.' }] },
        generationStatus: 'ready',
      }),
      searchVideos: async () => ({ videos: [], enrichmentStatus: 'no_key' }),
    };

    await withServer(overrides, async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/lessons/lesson-1/generate`, { method: 'POST' });
      const body = await response.json();
      assert.equal(body.courseId, 'course-1', `expected courseId on the response for a ${lesson.generationStatus} lesson`);
    });
  }
});

test('POST /api/lessons/:id/generate regenerates a degraded lesson without force', async () => {
  let modelCalls = 0;
  const lesson = lessonDocument({
    generationStatus: 'degraded',
    content: [{ type: 'paragraph', text: 'Fallback body.' }],
  });
  const overrides = {
    models: fakeModels({
      lesson,
      courseModule: { _id: 'module-1', title: 'Basics', course: 'course-1' },
      course: { _id: 'course-1', title: 'Rust' },
    }),
    generateLessonSafe: async () => {
      modelCalls += 1;
      return {
        value: { title: 'Ownership', objectives: [], content: [{ type: 'paragraph', text: 'Fresh body.' }] },
        generationStatus: 'ready',
      };
    },
    searchVideos: async () => ({ videos: [], enrichmentStatus: 'no_key' }),
  };

  await withServer(overrides, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/lessons/lesson-1/generate`, { method: 'POST' });
    const body = await response.json();
    assert.equal(modelCalls, 1);
    assert.equal(body.generationStatus, 'ready');
    assert.equal(body.content[0].text, 'Fresh body.');
  });
});

test('POST /api/lessons/:id/generate skips a ready lesson unless force is set', async () => {
  let modelCalls = 0;
  const lesson = lessonDocument({
    generationStatus: 'ready',
    content: [{ type: 'paragraph', text: 'Existing body.' }],
  });
  const overrides = {
    models: fakeModels({
      lesson,
      courseModule: { _id: 'module-1', title: 'Basics', course: 'course-1' },
      course: { _id: 'course-1', title: 'Rust' },
    }),
    generateLessonSafe: async () => {
      modelCalls += 1;
      return {
        value: { title: 'Ownership', objectives: [], content: [{ type: 'paragraph', text: 'Replacement.' }] },
        generationStatus: 'ready',
      };
    },
    searchVideos: async () => ({ videos: [], enrichmentStatus: 'no_key' }),
  };

  await withServer(overrides, async ({ baseUrl }) => {
    const skipped = await fetch(`${baseUrl}/api/lessons/lesson-1/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: false }),
    });
    assert.equal((await skipped.json()).content[0].text, 'Existing body.');
    assert.equal(modelCalls, 0);
    assert.equal(lesson.saves, 0);

    const forced = await fetch(`${baseUrl}/api/lessons/lesson-1/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    assert.equal((await forced.json()).content[0].text, 'Replacement.');
    assert.equal(modelCalls, 1);
    assert.equal(lesson.saves, 1);
  });
});

test('POST /api/lessons/:id/generate rejects malformed generation options', async () => {
  const lesson = lessonDocument();
  const overrides = { models: fakeModels({ lesson }) };

  await withServer(overrides, async ({ baseUrl }) => {
    for (const body of ['[]', 'null', '{"force":"yes"}', '{"regenerate":true}']) {
      const response = await fetch(`${baseUrl}/api/lessons/lesson-1/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      assert.equal(response.status, 400, `expected 400 for body ${body}`);
      const payload = await response.json();
      assert.equal(payload.error.code, 'invalid_request');
      assert.equal(lesson.saves, 0);
    }
  });
});

test('a lesson is persisted and returned even when YouTube is unavailable', async () => {
  const lesson = lessonDocument();
  const overrides = {
    models: fakeModels({
      lesson,
      courseModule: { _id: 'module-1', title: 'Basics', course: 'course-1' },
      course: { _id: 'course-1', title: 'Rust' },
    }),
    generateLessonSafe: async () => ({
      value: { title: 'Ownership', objectives: ['Learn it'], content: [{ type: 'paragraph', text: 'Body.' }] },
      generationStatus: 'ready',
    }),
    searchVideos: async () => ({ videos: [], enrichmentStatus: 'unavailable' }),
  };

  await withServer(overrides, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/lessons/lesson-1/generate`, { method: 'POST' });
    assert.equal(response.status, 200);
    const body = await response.json();

    // Enrichment is optional: its failure is recorded, and the lesson is
    // still written and still ready.
    assert.equal(body.generationStatus, 'ready');
    assert.equal(body.enrichmentStatus, 'unavailable');
    assert.deepEqual(body.videos, []);
    assert.deepEqual(body.content, [{ type: 'paragraph', text: 'Body.' }]);
    assert.equal(lesson.saves, 1);
  });
});

test('the bulk stream and the single-lesson route persist identical fields', async () => {
  const generation = {
    value: { title: 'Ownership', objectives: ['Learn it'], content: [{ type: 'paragraph', text: 'Body.' }] },
    generationStatus: 'degraded',
  };
  const providers = {
    generateLessonSafe: async () => generation,
    searchVideos: async () => ({ videos: [], enrichmentStatus: 'unavailable' }),
  };

  const single = lessonDocument();
  await withServer({
    ...providers,
    models: fakeModels({
      lesson: single,
      courseModule: { _id: 'module-1', title: 'Basics', course: 'course-1' },
      course: { _id: 'course-1', title: 'Rust' },
    }),
  }, async ({ baseUrl }) => {
    await fetch(`${baseUrl}/api/lessons/lesson-1/generate`, { method: 'POST' });
  });

  const bulk = lessonDocument();
  const course = {
    _id: 'course-1',
    title: 'Rust',
    modules: [{ _id: 'module-1', title: 'Basics', lessons: [bulk], toObject() { return { _id: this._id, title: this.title, lessons: this.lessons.map((l) => l.toObject()) }; } }],
  };
  await withServer({
    ...providers,
    models: {
      ...fakeModels({}),
      Course: { findById: () => queryReturning(course) },
    },
  }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/courses/course-1/generate-content`, { method: 'POST' });
    assert.equal(response.status, 200);
    await response.text();
  });

  for (const field of ['generationStatus', 'enrichmentStatus', 'isEnriched', 'objectives']) {
    assert.deepEqual(bulk[field], single[field], `bulk and single-lesson paths must agree on ${field}`);
  }
  assert.deepEqual(bulk.content, single.content);
});

test('the bulk stream emits a module per module and a counted done event', async () => {
  const lessons = [
    lessonDocument({ _id: 'l1', title: 'One' }),
    lessonDocument({ _id: 'l2', title: 'Two', generationStatus: 'ready', content: [{ type: 'paragraph', text: 'Kept.' }] }),
  ];
  const courseModule = {
    _id: 'module-1',
    title: 'Basics',
    lessons,
    toObject() { return { _id: this._id, title: this.title, lessons: this.lessons.map((l) => l.toObject()) }; },
  };
  const course = { _id: 'course-1', title: 'Rust', modules: [courseModule] };

  let modelCalls = 0;
  const overrides = {
    models: { ...fakeModels({}), Course: { findById: () => queryReturning(course) } },
    generateLessonSafe: async () => {
      modelCalls += 1;
      return {
        value: { title: 'One', objectives: [], content: [{ type: 'paragraph', text: 'Generated.' }] },
        generationStatus: 'degraded',
      };
    },
    searchVideos: async () => ({ videos: [], enrichmentStatus: 'no_key' }),
  };

  await withServer(overrides, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/courses/course-1/generate-content`, { method: 'POST' });
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const text = await response.text();

    assert.equal(modelCalls, 1, 'the ready lesson is skipped, the pending one is generated');

    const records = text.split('\n\n').filter(Boolean);
    const moduleRecords = records.filter((record) => record.startsWith('event: module'));
    assert.equal(moduleRecords.length, 1);
    const moduleData = JSON.parse(moduleRecords[0].split('\ndata: ')[1]);
    assert.deepEqual(moduleData.lessons.map((l) => l.generationStatus), ['degraded', 'ready']);

    const doneRecord = records.find((record) => record.startsWith('event: done'));
    const done = JSON.parse(doneRecord.split('\ndata: ')[1]);
    assert.deepEqual(done, {
      courseId: 'course-1',
      status: 'degraded',
      readyLessons: 1,
      degradedLessons: 1,
      totalLessons: 2,
    });
    assert.equal(done.readyLessons + done.degradedLessons, done.totalLessons);
  });
});

test('a replayed transaction callback rebuilds its documents from scratch', async () => {
  const { ObjectId } = require('mongoose').Types;

  const created = { courses: [], modules: [], lessons: [] };
  const outline = {
    title: 'Rust',
    description: '',
    tags: [],
    modules: [{ title: 'Basics', lessons: ['One', 'Two', 'Three'] }],
  };

  let replays = 0;
  const fakeMongoose = {
    Types: { ObjectId },
    async startSession() {
      return {
        // withTransaction replays its callback on a transient error. Each
        // replay must build fresh documents rather than reuse the previous
        // attempt's module references.
        async withTransaction(callback) {
          replays += 1;
          await callback();
          if (replays === 1) await callback();
        },
        async endSession() {},
      };
    },
  };

  const savedCourses = [];
  const Course = {
    create: async ([document]) => {
      const course = { ...document, _id: new ObjectId(), modules: [], async save() { savedCourses.push(this); return this; } };
      created.courses.push(course);
      return [course];
    },
    findById: () => queryReturning({ ...created.courses.at(-1), modules: [] }),
  };
  const Module = {
    create: async ([document]) => {
      created.modules.push(document);
      return [document];
    },
  };
  const Lesson = {
    insertMany: async (documents) => {
      const withIds = documents.map((document) => ({ ...document, _id: new ObjectId() }));
      created.lessons.push(...withIds);
      return withIds;
    },
    updateMany: async () => { throw new Error('the backfill pass must be gone'); },
  };

  await withServer({
    mongoose: fakeMongoose,
    models: { Course, Module, Lesson },
    generateCourseSafe: async () => ({ value: outline, outlineStatus: 'ready' }),
  }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/courses/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'Rust' }),
    });
    assert.equal(response.status, 201);
  });

  assert.equal(created.courses.length, 2, 'each replay creates its own course document');
  for (const course of created.courses) {
    assert.equal(course.modules.length, 1, 'exactly one set of module references per replay');
  }

  assert.equal(created.modules.length, 2);
  assert.equal(created.lessons.length, 6);
  for (const courseModule of created.modules) {
    const lessons = created.lessons.filter((lesson) => String(lesson.module) === String(courseModule._id));
    assert.equal(lessons.length, 3, 'every lesson is inserted already pointing at its preallocated module id');
    assert.deepEqual(
      courseModule.lessons.map(String).sort(),
      lessons.map((lesson) => String(lesson._id)).sort()
    );
  }
});
