'use strict';

// Model output handling: validate, repair once, then fall back -- and the
// transport policy underneath it. Schema rules themselves live in
// schemas.test.js.

const test = require('node:test');
const assert = require('node:assert');

const { validateCourse, generateCourseSafe } = require('../../services/gemini');

test('one malformed response is repaired by a single re-prompt', async () => {
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

  const { value, outlineStatus } = await generateCourseSafe('testing', { modelCall });

  assert.equal(calls, 2, 'expected exactly one repair re-prompt (2 total calls)');
  assert.equal(validateCourse(value).ok, true);
  assert.equal(value.title, validCourse.title);
  assert.equal(outlineStatus, 'ready', 'repaired model output is real content, not a fallback');
});

test('two invalid responses produce a labelled degraded outline', async () => {
  let calls = 0;
  // Garbage on both the original call and the repair attempt.
  const modelCall = async () => {
    calls += 1;
    return 'not json at all, still not json';
  };

  const { value, outlineStatus } = await generateCourseSafe('testing', { modelCall });

  assert.equal(calls, 2, 'expected exactly one repair attempt before falling back');
  assert.equal(validateCourse(value).ok, true, 'the fallback course must itself be valid/renderable');
  assert.equal(outlineStatus, 'degraded', 'a fallback outline must be labelled degraded');
});

test('a parser error never reaches the caller', async () => {
  // The caller (courseController) should only ever see either a valid course
  // object or a typed, intentional error — never a raw parser exception.
  const modelCall = async () => '{{{ garbage';
  await assert.doesNotReject(() => generateCourseSafe('testing', { modelCall }));
});

// --- Transport policy, exercised through the real SDK ----------------------
// global.fetch is replaced, so the installed @google/generative-ai client
// does its own status handling and no request leaves the process. The API
// key is a fixed fake string; a developer .env is never read here.

const {
  generateLessonSafe,
  MODEL_STAGE_TOTAL_MS,
} = require('../../services/gemini');
const {
  UpstreamError,
  GenerationTimeoutError,
  OperationAbortedError,
  monotonicNow,
  deadlineIn,
} = require('../../services/resilience');
const { ConfigurationError } = require('../../utils/errors');

const VALID_LESSON = {
  title: 'Ownership',
  objectives: ['Understand ownership'],
  content: [
    { type: 'heading', text: 'Ownership' },
    { type: 'paragraph', text: 'Rust tracks who owns each value.' },
    { type: 'paragraph', text: 'Ownership moves on assignment.' },
    { type: 'mcq', question: 'Who owns it?', options: ['a', 'b'], answer: 0, explanation: '' },
  ],
};

function modelBody(payload) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: 'STOP' }],
  };
}

function httpResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: () => null },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

async function withFakeTransport(handler, run) {
  const originalFetch = global.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fake-key-for-test';
  const calls = [];
  global.fetch = async (...args) => {
    calls.push(args);
    return handler(calls.length, ...args);
  };
  try {
    return await run(calls);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
}

for (const status of [400, 401, 403]) {
  test(`an HTTP ${status} fails after exactly one attempt`, async () => {
    await withFakeTransport(
      async () => httpResponse(status, { error: { message: 'nope' } }),
      async (calls) => {
        await assert.rejects(
          () => generateLessonSafe('Rust', 'Basics', 'Ownership'),
          (err) => {
            assert.ok(err instanceof UpstreamError);
            assert.equal(err.status, status);
            assert.equal(err.retriable, false, 'a non-429 4xx is not worth retrying');
            return true;
          }
        );
        assert.equal(calls.length, 1);
      }
    );
  });
}

for (const status of [429, 503]) {
  test(`an HTTP ${status} is retried within the budget and then gives up`, async () => {
    await withFakeTransport(
      async () => httpResponse(status, { error: { message: 'later' } }),
      async (calls) => {
        await assert.rejects(
          () => generateLessonSafe('Rust', 'Basics', 'Ownership', { deadlineAt: deadlineIn(1_500) }),
          (err) => {
            assert.ok(err instanceof UpstreamError || err instanceof GenerationTimeoutError);
            return true;
          }
        );
        assert.ok(calls.length > 1, `expected a retry, saw ${calls.length} call(s)`);
        assert.ok(calls.length <= 3, `expected at most 3 attempts, saw ${calls.length}`);
      }
    );
  });
}

test('a missing API key fails immediately with no request at all', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; throw new Error('should not be reached'); };

  try {
    await assert.rejects(
      () => generateLessonSafe('Rust', 'Basics', 'Ownership'),
      ConfigurationError
    );
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
  }
});

test('a valid SDK response produces a ready lesson', async () => {
  await withFakeTransport(
    async () => httpResponse(200, modelBody(VALID_LESSON)),
    async (calls) => {
      const { value, generationStatus } = await generateLessonSafe('Rust', 'Basics', 'Ownership');
      assert.equal(generationStatus, 'ready');
      assert.equal(value.title, 'Ownership');
      assert.equal(calls.length, 1);
    }
  );
});

test('the first round and the repair round share one model deadline', async () => {
  let deadlines = [];
  const modelCall = async (_prompt, options) => {
    deadlines.push(options.deadlineAt);
    return 'not json';
  };

  const before = monotonicNow();
  const { generationStatus } = await generateLessonSafe('Rust', 'Basics', 'Ownership', { modelCall });

  assert.equal(deadlines.length, 2, 'exactly one repair round');
  assert.equal(deadlines[0], deadlines[1], 'the repair does not get a fresh budget');
  assert.ok(deadlines[0] - before <= MODEL_STAGE_TOTAL_MS + 50);
  assert.equal(generationStatus, 'degraded');
});

test('an exhausted model deadline does not start a repair round', async () => {
  let calls = 0;
  const modelCall = async () => {
    calls += 1;
    // Consume the whole stage budget on the first round.
    await new Promise((resolve) => setTimeout(resolve, 60));
    return 'not json';
  };

  await assert.rejects(
    () => generateLessonSafe('Rust', 'Basics', 'Ownership', { modelCall, deadlineAt: deadlineIn(50) }),
    GenerationTimeoutError
  );
  assert.equal(calls, 1, 'the second round must not start once the deadline has passed');
});

test('cancellation propagates instead of producing a fallback lesson', async () => {
  const controller = new AbortController();
  const modelCall = async () => {
    controller.abort();
    return 'not json';
  };

  await assert.rejects(
    () => generateLessonSafe('Rust', 'Basics', 'Ownership', { modelCall, signal: controller.signal }),
    OperationAbortedError
  );
});
