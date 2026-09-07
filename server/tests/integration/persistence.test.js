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
