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

test('with no token configured the API is open, as in local development', async () => {
  await withServer(baseOverrides(), async ({ baseUrl }) => {
    assert.equal((await fetch(`${baseUrl}/api/courses/course-1`)).status, 200);
  });
});

test('with a token configured every /api request must carry it', async () => {
  await withServer(baseOverrides({ accessToken: 's3cret-token' }), async ({ baseUrl }) => {
    const missing = await fetch(`${baseUrl}/api/courses/course-1`);
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), {
      error: { code: 'unauthorized', message: 'A valid API token is required' },
    });

    const wrong = await fetch(`${baseUrl}/api/courses/course-1`, { headers: { 'X-API-Token': 'wrong-length-x' } });
    assert.equal(wrong.status, 401);
    assert.deepEqual(
      await wrong.json(),
      { error: { code: 'unauthorized', message: 'A valid API token is required' } },
      'a wrong token is not distinguished from a missing one',
    );

    const right = await fetch(`${baseUrl}/api/courses/course-1`, { headers: { 'X-API-Token': 's3cret-token' } });
    assert.equal(right.status, 200);
  });
});

test('the gate protects the endpoints that spend money', async () => {
  await withServer(baseOverrides({ accessToken: 's3cret-token' }), async ({ baseUrl }) => {
    const generate = await fetch(`${baseUrl}/api/courses/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'Rust' }),
    });
    assert.equal(generate.status, 401, 'an ungated generate request would be an open billing endpoint');
  });
});

test('readiness and the root endpoint stay reachable without a token', async () => {
  await withServer(baseOverrides({ accessToken: 's3cret-token' }), async ({ baseUrl }) => {
    // A platform health check cannot be expected to hold the secret.
    assert.equal((await fetch(`${baseUrl}/healthz`)).status, 503);
    assert.equal((await fetch(`${baseUrl}/`)).status, 200);
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
  assert.equal(normalizeError(new HttpError(401, 'unauthorized', 'A valid API token is required')).retriable, false);
});
