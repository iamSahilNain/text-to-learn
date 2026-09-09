'use strict';

// The two deployment guards, over real HTTP.

const test = require('node:test');
const assert = require('node:assert');

const { startTestServer } = require('./helpers/server');
const { queryReturning } = require('./helpers/fakes');

const COURSE = { _id: 'course-1', title: 'Rust', description: '', tags: [], outlineStatus: 'ready', modules: [] };

// Persistence is irrelevant here: the limiter counts a request whatever it
// returns, and a real mongoose with no connection would stall each call on
// server selection.
const failingMongoose = {
  Types: { ObjectId: class { } },
  startSession: async () => { throw new Error('no database in this test'); },
};

function baseOverrides(extra = {}) {
  return {
    mongoose: failingMongoose,
    models: {
      Course: { findById: () => queryReturning(COURSE), find: () => queryReturning([]) },
      Module: { findById: async () => null },
      Lesson: { findById: async () => null },
    },
    generateCourseSafe: async () => ({
      value: { title: 'Rust', description: '', tags: [], modules: [{ title: 'Basics', lessons: ['a', 'b', 'c'] }] },
      outlineStatus: 'ready',
    }),
    ...extra,
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

test('with no login configured the API is open, as in local development', async () => {
  await withServer(baseOverrides(), async ({ baseUrl }) => {
    assert.equal((await fetch(`${baseUrl}/api/courses/course-1`)).status, 200);
  });
});

test('with a login configured every /api request requires authentication', async () => {
  await withServer(baseOverrides({ auth: { username: 'owner', password: 'test-password-long-enough' } }), async ({ baseUrl }) => {
    const missing = await fetch(`${baseUrl}/api/courses/course-1`);
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), {
      error: { code: 'unauthorized', message: 'A valid app login is required' },
    });

    const wrong = await fetch(`${baseUrl}/api/courses/course-1`, { headers: { Authorization: 'Basic ' + Buffer.from('owner:wrong').toString('base64') } });
    assert.equal(wrong.status, 401);
    assert.deepEqual(
      await wrong.json(),
      { error: { code: 'unauthorized', message: 'A valid app login is required' } },
      'a wrong token is not distinguished from a missing one',
    );

    const right = await fetch(`${baseUrl}/api/courses/course-1`, { headers: { Authorization: 'Basic ' + Buffer.from('owner:test-password-long-enough').toString('base64') } });
    assert.equal(right.status, 200);
  });
});

test('the gate protects the endpoints that spend money', async () => {
  await withServer(baseOverrides({ auth: { username: 'owner', password: 'test-password-long-enough' } }), async ({ baseUrl }) => {
    const generate = await fetch(`${baseUrl}/api/courses/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'Rust' }),
    });
    assert.equal(generate.status, 401, 'an ungated generate request would be an open billing endpoint');
  });
});

test('the gate protects PDF export and lesson generation too, with zero provider calls or writes when rejected', async () => {
  let lessonGenerateCalls = 0;
  let videoSearchCalls = 0;
  let lessonSaves = 0;
  const lesson = {
    _id: 'lesson-1', title: 'Ownership', objectives: [], content: [], videos: [],
    generationStatus: 'pending', module: 'module-1',
    async save() { lessonSaves += 1; return this; },
  };
  const overrides = baseOverrides({
    auth: { username: 'owner', password: 'test-password-long-enough' },
    models: {
      Course: { findById: () => queryReturning(COURSE), find: () => queryReturning([]) },
      Module: { findById: () => queryReturning({ _id: 'module-1', title: 'Basics', course: 'course-1' }) },
      Lesson: { findById: () => queryReturning(lesson) },
    },
    generateLessonSafe: async () => {
      lessonGenerateCalls += 1;
      return {
        value: { title: 'Ownership', objectives: [], content: [{ type: 'paragraph', text: 'x' }] },
        generationStatus: 'ready',
      };
    },
    searchVideos: async () => {
      videoSearchCalls += 1;
      return { videos: [], enrichmentStatus: 'no_key' };
    },
  });

  await withServer(overrides, async ({ baseUrl }) => {
    assert.equal((await fetch(`${baseUrl}/api/courses/course-1/pdf`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/lessons/lesson-1`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/lessons/lesson-1/generate`, { method: 'POST' })).status, 401);

    assert.equal(lessonGenerateCalls, 0, 'a rejected request must never reach the model provider');
    assert.equal(videoSearchCalls, 0, 'a rejected request must never reach the video provider');
    assert.equal(lessonSaves, 0, 'a rejected request must never persist a write');

    const headers = { Authorization: 'Basic ' + Buffer.from('owner:test-password-long-enough').toString('base64') };

    const pdfOk = await fetch(`${baseUrl}/api/courses/course-1/pdf`, { headers });
    assert.equal(pdfOk.status, 200);
    assert.equal(pdfOk.headers.get('content-type'), 'application/pdf');
    await pdfOk.arrayBuffer();

    assert.equal((await fetch(`${baseUrl}/api/lessons/lesson-1`, { headers })).status, 200);

    const lessonGenerateOk = await fetch(`${baseUrl}/api/lessons/lesson-1/generate`, { method: 'POST', headers });
    assert.equal(lessonGenerateOk.status, 200);
    assert.equal(lessonGenerateCalls, 1, 'valid auth reaches the handler');
    assert.equal(lessonSaves, 1);
  });
});

test('readiness stays public while the root requires login', async () => {
  await withServer(baseOverrides({ auth: { username: 'owner', password: 'test-password-long-enough' } }), async ({ baseUrl }) => {
    // A platform health check cannot be expected to hold the secret.
    assert.equal((await fetch(`${baseUrl}/healthz`)).status, 503);
    assert.equal((await fetch(`${baseUrl}/`)).status, 401);
  });
});

test('generation is rate limited well before an ordinary read is', async () => {
  await withServer(baseOverrides({ rateLimits: { generationMax: 3, globalMax: 100 } }), async ({ baseUrl }) => {
    const statuses = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/courses/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: 'Rust' }),
      });
      statuses.push(response.status);
      if (response.status === 429) {
        assert.deepEqual(await response.json(), {
          error: { code: 'rate_limited', message: 'Too many requests. Please wait and try again.' },
        });
      } else {
        await response.text();
      }
    }

    assert.deepEqual(
      statuses.slice(0, 3),
      [500, 500, 500],
      `the first three are allowed through (and fail on the absent database), got ${statuses}`,
    );
    assert.deepEqual(statuses.slice(3), [429, 429], `expected the 4th and 5th to be limited, got ${statuses}`);
    // Reads are not charged against the generation budget.
    assert.equal((await fetch(`${baseUrl}/api/courses/course-1`)).status, 200);
  });
});

test('the global limit covers reads too', async () => {
  await withServer(baseOverrides({ rateLimits: { generationMax: 50, globalMax: 3 } }), async ({ baseUrl }) => {
    const statuses = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/courses/course-1`);
      statuses.push(response.status);
      await response.text();
    }
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
  });
});

test('a rate-limited response advertises itself as retriable', async () => {
  const { normalizeError } = require('../../utils/errors');
  const { HttpError } = require('../../utils/errors');
  assert.deepEqual(normalizeError(new HttpError(429, 'rate_limited', 'Too many requests. Please wait and try again.')), {
    status: 429,
    code: 'rate_limited',
    message: 'Too many requests. Please wait and try again.',
    retriable: true,
  });
  assert.equal(normalizeError(new HttpError(401, 'unauthorized', 'A valid app login is required')).retriable, false);
});


test('production fails closed without app credentials', () => {
  const { createApp } = require('../../app');
  assert.throws(() => createApp({ environment: 'production', auth: {} }), /Production requires/);
});

test('authenticated cross-origin mutations are rejected before generation', async () => {
  await withServer(baseOverrides({ auth: { username: 'owner', password: 'test-password-long-enough' } }), async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/courses/generate`, {
      method: 'POST', headers: {
        Authorization: 'Basic ' + Buffer.from('owner:test-password-long-enough').toString('base64'),
        Origin: 'https://attacker.example', 'Content-Type': 'application/json',
      }, body: JSON.stringify({ topic: 'Rust' }),
    });
    assert.equal(response.status, 403);
  });
});

test('production serves protected SPA deep links and assets, and API misses remain JSON', async () => {
  const { mkdtemp, writeFile, rm } = require('node:fs/promises');
  const { tmpdir } = require('node:os');
  const path = require('node:path');
  const staticDir = await mkdtemp(path.join(tmpdir(), 'ttl-static-'));
  try {
    await writeFile(path.join(staticDir, 'index.html'), '<html>app-shell</html>');
    await writeFile(path.join(staticDir, 'app.js'), 'window.app = true');
    await withServer(baseOverrides({ environment: 'production', staticDir,
      auth: { username: 'owner', password: 'test-password-long-enough' } }), async ({ baseUrl }) => {
      const headers = { Authorization: 'Basic ' + Buffer.from('owner:test-password-long-enough').toString('base64') };
      for (const url of ['/', '/course/123', '/app.js']) {
        const anonymous = await fetch(baseUrl + url);
        assert.equal(anonymous.status, 401);
        assert.match(anonymous.headers.get('www-authenticate'), /^Basic /);
        const authenticated = await fetch(baseUrl + url, { headers });
        assert.equal(authenticated.status, 200);
        assert.match(await authenticated.text(), url.endsWith('.js') ? /window.app/ : /app-shell/);
      }
      const missing = await fetch(baseUrl + '/api/missing', { headers });
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).error.code, 'not_found');
      assert.equal((await fetch(baseUrl + '/missing.js', { headers })).status, 404);
    });
  } finally { await rm(staticDir, { recursive: true, force: true }); }
});
