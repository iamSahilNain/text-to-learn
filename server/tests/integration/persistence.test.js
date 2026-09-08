'use strict';

// Real persistence against the test replica set. Upstream providers are
// fakes; the database is genuine, because transaction rollback cannot be
// proved with a mock.

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const { connectTestDatabase, clearTestDatabase, disconnectTestDatabase } = require('./helpers/database');
const { startTestServer } = require('./helpers/server');

const Course = require('../../models/Course');
const Module = require('../../models/Module');
const Lesson = require('../../models/Lesson');

const models = { Course, Module, Lesson };

const OUTLINE = {
  title: 'Rust Ownership',
  description: 'A short course.',
  tags: ['rust'],
  modules: [
    { title: 'Basics', lessons: ['Ownership', 'Borrowing', 'Lifetimes'] },
    { title: 'Advanced', lessons: ['Smart pointers', 'Interior mutability', 'Unsafe'] },
  ],
};

const generateCourseSafe = async () => ({ value: OUTLINE, outlineStatus: 'ready' });
const generateLessonSafe = async (_courseTitle, _moduleTitle, lessonTitle) => ({
  value: { title: lessonTitle, objectives: ['Learn it'], content: [{ type: 'paragraph', text: 'Generated body.' }] },
  generationStatus: 'ready',
});
const searchVideos = async () => ({ videos: [], enrichmentStatus: 'no_key' });

test.before(async () => {
  await connectTestDatabase();
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await clearTestDatabase();
  await disconnectTestDatabase();
});

async function withServer(overrides, run) {
  const started = await startTestServer({ mongoose, models, generateCourseSafe, generateLessonSafe, searchVideos, ...overrides });
  try {
    return await run(started);
  } finally {
    await started.close();
  }
}

test('creating a course links courses, modules and lessons in both directions', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/courses/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: '  Rust ownership  ' }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.outlineStatus, 'ready');

    assert.equal(await Course.countDocuments(), 1);
    assert.equal(await Module.countDocuments(), 2);
    assert.equal(await Lesson.countDocuments(), 6);

    const course = await Course.findById(body._id);
    assert.equal(course.modules.length, 2);

    for (const moduleId of course.modules) {
      const courseModule = await Module.findById(moduleId);
      assert.equal(String(courseModule.course), String(course._id));
      assert.equal(courseModule.lessons.length, 3);

      const lessons = await Lesson.find({ _id: { $in: courseModule.lessons } });
      assert.equal(lessons.length, 3);
      for (const lesson of lessons) {
        // The module reference is written with the lesson, not backfilled
        // by a second pass.
        assert.equal(String(lesson.module), String(courseModule._id));
        assert.equal(lesson.generationStatus, 'pending');
        assert.equal(lesson.enrichmentStatus, 'pending');
        assert.equal(lesson.isEnriched, false);
      }
    }
  });
});

test('a failure between module writes leaves nothing persisted', async () => {
  let moduleCreates = 0;
  const failingModule = {
    ...Module,
    create: async (...args) => {
      moduleCreates += 1;
      if (moduleCreates === 2) throw new Error('injected write failure');
      return Module.create(...args);
    },
  };

  await withServer({ models: { Course, Module: failingModule, Lesson } }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/courses/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'Rust ownership' }),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { code: 'internal_error', message: 'Something went wrong' },
    });
  });

  assert.equal(await Course.countDocuments(), 0, 'the course must roll back');
  assert.equal(await Module.countDocuments(), 0);
  assert.equal(await Lesson.countDocuments(), 0, 'lessons written before the failure must roll back too');
});

test('a failed regeneration leaves the stored lesson unchanged', async () => {
  let courseId;
  await withServer({}, async ({ baseUrl }) => {
    const created = await (await fetch(`${baseUrl}/api/courses/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'Rust ownership' }),
    })).json();
    courseId = created._id;

    const lessonId = created.modules[0].lessons[0]._id;
    await fetch(`${baseUrl}/api/lessons/${lessonId}/generate`, { method: 'POST' });
  });

  const course = await Course.findById(courseId).populate({ path: 'modules', populate: { path: 'lessons' } });
  const lesson = course.modules[0].lessons[0];
  assert.equal(lesson.generationStatus, 'ready');
  const before = lesson.toObject();

  await withServer({
    generateLessonSafe: async () => { throw new Error('provider is down'); },
  }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/lessons/${lesson._id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(response.status, 500);
  });

  const after = (await Lesson.findById(lesson._id)).toObject();
  assert.deepEqual(after.content, before.content);
  assert.equal(after.generationStatus, 'ready');
  assert.deepEqual(after.updatedAt, before.updatedAt, 'a failed regeneration writes nothing at all');
});

test('a ready lesson is not rewritten by an ordinary retry', async () => {
  let lessonId;
  let updatedAt;
  await withServer({}, async ({ baseUrl }) => {
    const created = await (await fetch(`${baseUrl}/api/courses/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'Rust ownership' }),
    })).json();
    lessonId = created.modules[0].lessons[0]._id;
    await fetch(`${baseUrl}/api/lessons/${lessonId}/generate`, { method: 'POST' });
    updatedAt = (await Lesson.findById(lessonId)).updatedAt;

    let modelCalls = 0;
    const started = await startTestServer({
      mongoose,
      models,
      generateCourseSafe,
      searchVideos,
      generateLessonSafe: async (...args) => { modelCalls += 1; return generateLessonSafe(...args); },
    });
    try {
      const response = await fetch(`${started.baseUrl}/api/lessons/${lessonId}/generate`, { method: 'POST' });
      assert.equal(response.status, 200);
      assert.equal(modelCalls, 0);
    } finally {
      await started.close();
    }
  });

  assert.deepEqual((await Lesson.findById(lessonId)).updatedAt, updatedAt, 'no duplicate write for a ready lesson');
});

test('the HTTP error table holds at the real route boundary', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const malformedJson = await fetch(`${baseUrl}/api/courses/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(malformedJson.status, 400);
    assert.deepEqual(await malformedJson.json(), {
      error: { code: 'invalid_json', message: 'Request body must be valid JSON' },
    });

    const tooLarge = await fetch(`${baseUrl}/api/courses/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'x'.repeat(200_000) }),
    });
    assert.equal(tooLarge.status, 413);
    assert.deepEqual(await tooLarge.json(), {
      error: { code: 'request_too_large', message: 'Request body exceeds 100 KB' },
    });

    const badId = await fetch(`${baseUrl}/api/lessons/not-an-object-id/generate`, { method: 'POST' });
    assert.equal(badId.status, 400);
    assert.deepEqual(await badId.json(), {
      error: { code: 'bad_id', message: 'Invalid resource ID' },
    });

    const missing = await fetch(`${baseUrl}/api/courses/${new mongoose.Types.ObjectId()}`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'not_found');

    const emptyTopic = await fetch(`${baseUrl}/api/courses/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: '   ' }),
    });
    assert.equal(emptyTopic.status, 400);
    assert.equal((await emptyTopic.json()).error.code, 'invalid_topic');
  });
});

test('an exhausted model call is a 502 and a database fault is a 500', async () => {
  const { UpstreamError } = require('../../services/resilience');

  await withServer({
    generateCourseSafe: async () => {
      throw new UpstreamError('503 from https://generativelanguage.googleapis.com/v1?key=SECRET', {
        status: 503, retriable: true, attempts: 3,
      });
    },
  }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/courses/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'Rust ownership' }),
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.deepEqual(body, {
      error: { code: 'upstream_unavailable', message: 'Generation provider is unavailable' },
    });
    assert.equal(JSON.stringify(body).includes('SECRET'), false);
  });

  const failingCourse = { ...Course, findById: () => { throw Object.assign(new Error('connection reset'), { name: 'MongoNetworkError' }); } };
  await withServer({ models: { Course: failingCourse, Module, Lesson } }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/courses/${new mongoose.Types.ObjectId()}`);
    assert.equal(response.status, 500, 'a database fault is not an upstream generation failure');
    assert.deepEqual(await response.json(), {
      error: { code: 'internal_error', message: 'Something went wrong' },
    });
  });
});

test('the export endpoint streams a parseable PDF and reports its failures once', async () => {
  const { PDFDocument } = require('pdf-lib');
  let courseId;

  await withServer({}, async ({ baseUrl }) => {
    const created = await (await fetch(`${baseUrl}/api/courses/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'Rust ownership' }),
    })).json();
    courseId = created._id;

    const response = await fetch(`${baseUrl}/api/courses/${courseId}/pdf`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 1);
  });

  // A synchronous render failure happens before any byte is written, so the
  // ordinary JSON envelope is still available.
  const { createDefaultPdfDocument } = require('../../services/pdf');
  await withServer({
    createPdfDocument: () => {
      const doc = createDefaultPdfDocument();
      doc.text = () => { throw new Error('render exploded'); };
      return doc;
    },
  }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/courses/${courseId}/pdf`);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('content-type').startsWith('application/json'), true);
    assert.deepEqual(await response.json(), {
      error: { code: 'internal_error', message: 'Something went wrong' },
    });
  });
});

test('readiness reflects the database connection', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });

  await withServer({ mongoose: { ...mongoose, connection: { readyState: 0 } } }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'unavailable' });
  });
});

test('the course list pages with an explicit envelope and a stable order', async () => {
  const created = [];
  for (let index = 0; index < 21; index += 1) {
    // Identical timestamps on purpose: the _id tiebreaker is what keeps the
    // order stable, and an unstable order is how records go missing.
    created.push(await Course.create({
      title: `Course ${index + 1}`,
      description: '',
      tags: [],
      outlineStatus: 'ready',
      modules: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }));
  }
  const expectedOrder = [...created].sort((a, b) => String(b._id).localeCompare(String(a._id))).map((c) => c.title);

  await withServer({}, async ({ baseUrl }) => {
    const first = await (await fetch(`${baseUrl}/api/courses?page=1&limit=20`)).json();
    assert.equal(first.page, 1);
    assert.equal(first.pageSize, 20);
    assert.equal(first.hasMore, true);
    assert.equal(first.courses.length, 20);
    assert.deepEqual(first.courses.map((c) => c.title), expectedOrder.slice(0, 20));

    const second = await (await fetch(`${baseUrl}/api/courses?page=2&limit=20`)).json();
    assert.equal(second.hasMore, false, 'the extra fetched record is what answers this, not a full page');
    assert.equal(second.courses.length, 1);
    assert.deepEqual(second.courses.map((c) => c.title), expectedOrder.slice(20));

    // No record appears on both pages and none is skipped.
    const seen = [...first.courses, ...second.courses].map((c) => c.title);
    assert.equal(new Set(seen).size, 21);

    const third = await (await fetch(`${baseUrl}/api/courses?page=3&limit=20`)).json();
    assert.deepEqual(third, { courses: [], page: 3, pageSize: 20, hasMore: false });

    const defaults = await (await fetch(`${baseUrl}/api/courses`)).json();
    assert.equal(defaults.page, 1);
    assert.equal(defaults.pageSize, 20);
  });
});

test('an exactly full page does not claim another one exists', async () => {
  for (let index = 0; index < 20; index += 1) {
    await Course.create({ title: `Course ${index + 1}`, outlineStatus: 'ready', modules: [] });
  }
  await withServer({}, async ({ baseUrl }) => {
    const page = await (await fetch(`${baseUrl}/api/courses?page=1&limit=20`)).json();
    assert.equal(page.courses.length, 20);
    assert.equal(page.hasMore, false);
  });
});

test('invalid pagination values are refused rather than rounded into defaults', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const invalid = [
      'page=2x', 'page=1.5', 'page=0', 'page=-1', 'page=1e3', 'page= 1', 'page=',
      'limit=0', 'limit=51', 'limit=abc', 'limit=2.5', 'limit=-3',
      'page=1&page=2',
      `page=${Number.MAX_SAFE_INTEGER}&limit=50`,
      'page=99999999999999999999',
    ];

    for (const query of invalid) {
      const response = await fetch(`${baseUrl}/api/courses?${query}`);
      assert.equal(response.status, 400, `expected 400 for ?${query}`);
      assert.deepEqual(await response.json(), {
        error: { code: 'invalid_pagination', message: 'page and limit must be valid positive integers' },
      });
    }

    for (const query of ['', 'page=1', 'limit=1', 'page=3&limit=50']) {
      const response = await fetch(`${baseUrl}/api/courses?${query}`);
      assert.equal(response.status, 200, `expected 200 for ?${query}`);
    }
  });
});

test('legacy list records are returned with an effective outline status', async () => {
  // Written straight to the collection, without the status field, exactly
  // as the pre-status code left it.
  await mongoose.connection.db.collection('courses').insertOne({
    title: 'Legacy course',
    description: 'Written before outlineStatus existed.',
    tags: [],
    modules: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await withServer({}, async ({ baseUrl }) => {
    const payload = await (await fetch(`${baseUrl}/api/courses?page=1&limit=20`)).json();
    assert.equal(payload.courses.length, 1);
    assert.equal(payload.courses[0].outlineStatus, 'ready');
  });
});


test('legacy degraded outline has the same status in list and detail without migration', async () => {
  const markers = require('../../services/generationStatus');
  const courseId = new mongoose.Types.ObjectId();
  const moduleId = new mongoose.Types.ObjectId();
  const lessonIds = markers.LEGACY_OUTLINE_LESSON_TITLES.map(() => new mongoose.Types.ObjectId());
  await Lesson.collection.insertMany(lessonIds.map((_id, index) => ({
    _id, title: markers.LEGACY_OUTLINE_LESSON_TITLES[index], module: moduleId,
  })));
  await Module.collection.insertOne({ _id: moduleId, title: markers.LEGACY_OUTLINE_MODULE_TITLE, lessons: lessonIds, course: courseId });
  await Course.collection.insertOne({ _id: courseId, title: 'Rust' + markers.LEGACY_OUTLINE_TITLE_SUFFIX,
    description: markers.LEGACY_OUTLINE_DESCRIPTION, tags: [], modules: [moduleId], createdAt: new Date() });
  await withServer({}, async ({ baseUrl }) => {
    const listResponse = await fetch(`${baseUrl}/api/courses?page=1&limit=20`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    const detail = await (await fetch(`${baseUrl}/api/courses/${courseId}`)).json();
    assert.equal(list.courses[0].outlineStatus, 'degraded');
    assert.equal(detail.outlineStatus, 'degraded');
    assert.deepEqual(list.courses[0].modules, [String(moduleId)]);
  });
});
