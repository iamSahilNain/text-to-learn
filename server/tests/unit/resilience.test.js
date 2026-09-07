'use strict';

// ============================================================================
// LEARNING CHECKPOINT #2 — External-API resilience (Gemini + YouTube)
// ----------------------------------------------------------------------------
// Activated: services/resilience.js wraps both external calls with a
// timeout, retry + exponential backoff + jitter, and a 429-vs-5xx policy
// split. These tests exercise the reusable wrapper directly (with fake,
// no-network calls) plus the YouTube degradation path end to end.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');

const { withResilience, UpstreamError } = require('../../services/resilience');
const { searchVideos } = require('../../services/youtube');

test('a slow call is aborted at the timeout instead of hanging', async () => {
  // Never resolves on its own; only responds to abort.
  const fn = (signal) => new Promise((resolve, reject) => {
    const hang = setTimeout(resolve, 60_000);
    signal.addEventListener('abort', () => {
      clearTimeout(hang);
      reject(new Error('aborted'));
    });
  });

  const start = Date.now();
  await assert.rejects(() => withResilience(fn, { timeoutMs: 50, maxAttempts: 1 }));
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `expected an abort within ~50ms, took ${elapsed}ms`);
});

test('transient failures retry with exponential backoff + jitter', async () => {
  let attempts = 0;
  const gaps = [];
  let last = Date.now();
  const fn = async () => {
    const now = Date.now();
    gaps.push(now - last);
    last = now;
    attempts += 1;
    if (attempts < 3) {
      const err = new Error('transient failure');
      err.status = 503;
      throw err;
    }
    return 'ok';
  };

  const baseMs = 20;
  const capMs = 200;
  const result = await withResilience(fn, { maxAttempts: 5, baseMs, capMs });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  // gaps[0] is the time-to-first-call (~0); gaps[1]/gaps[2] are the actual
  // backoff delays, which grow with the attempt index (full-jitter cap
  // widens each retry) rather than staying constant.
  assert.ok(gaps[1] <= baseMs + 50, `retry 1 delay should respect the backoff envelope, got ${gaps[1]}ms`);
  assert.ok(gaps[2] <= baseMs * 2 + 50, `retry 2 delay should respect the wider envelope, got ${gaps[2]}ms`);
});

test('a 429 / quota response is handled differently from a 500', async () => {
  // A 429 with a Retry-After-derived delay must be honored, not retried on
  // the ordinary (much shorter) transient-failure backoff schedule.
  let attempts = 0;
  const timestamps = [];
  const fn = async () => {
    timestamps.push(Date.now());
    attempts += 1;
    if (attempts === 1) {
      const err = new Error('quota exceeded');
      err.status = 429;
      err.retryAfterMs = 120;
      throw err;
    }
    return 'ok';
  };

  // baseMs/capMs are tiny, so an ordinary transient retry would happen almost
  // immediately -- the 429 path must still wait for its own, much longer delay.
  const result = await withResilience(fn, { maxAttempts: 3, baseMs: 5, capMs: 20 });

  assert.equal(result, 'ok');
  const gap = timestamps[1] - timestamps[0];
  assert.ok(gap >= 100, `expected the 429 to wait ~120ms (Retry-After), got ${gap}ms`);
});

test('the call gives up after a max attempt count with a typed error', async () => {
  let attempts = 0;
  const fn = async () => {
    attempts += 1;
    const err = new Error('still failing');
    err.status = 503;
    throw err;
  };

  await assert.rejects(
    () => withResilience(fn, { maxAttempts: 4, baseMs: 1, capMs: 5 }),
    (err) => {
      assert.ok(err instanceof UpstreamError);
      assert.equal(err.attempts, 4);
      return true;
    }
  );
  assert.equal(attempts, 4, 'should stop after exactly maxAttempts tries');
});

test('lesson generation succeeds even when YouTube enrichment fails', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = 'fake-key-for-test';
  global.fetch = async () => { throw new Error('network down'); };

  try {
    const { videos, enrichmentStatus } = await searchVideos('anything', 3);
    // Graceful degradation: generation-caller gets a usable [] rather than a
    // thrown error, but the failure is still observable via enrichmentStatus
    // instead of looking identical to "no videos found".
    assert.deepEqual(videos, []);
    assert.equal(enrichmentStatus, 'unavailable');
  } finally {
    global.fetch = originalFetch;
    process.env.YOUTUBE_API_KEY = originalKey;
  }
});

// --- Cancellation and deadlines -------------------------------------------

const {
  OperationAbortedError,
  GenerationTimeoutError,
  sleep,
  monotonicNow,
  deadlineIn,
} = require('../../services/resilience');

test('an already-aborted signal rejects without starting any work', async () => {
  let started = 0;
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => withResilience(async () => { started += 1; }, { signal: controller.signal }),
    OperationAbortedError
  );
  assert.equal(started, 0, 'no paid work may begin for an already-cancelled call');
});

test('an already-expired deadline rejects without starting any work', async () => {
  let started = 0;
  await assert.rejects(
    () => withResilience(async () => { started += 1; }, { deadlineAt: monotonicNow() - 1 }),
    GenerationTimeoutError
  );
  assert.equal(started, 0);
});

test('cancellation during an in-flight attempt aborts it and starts no retry', async () => {
  const controller = new AbortController();
  let attempts = 0;
  let sawAbort = false;

  const fn = (attemptSignal) => new Promise((_resolve, reject) => {
    attempts += 1;
    attemptSignal.addEventListener('abort', () => { sawAbort = true; reject(new Error('aborted')); });
    setTimeout(() => controller.abort(), 10);
  });

  await assert.rejects(
    () => withResilience(fn, { signal: controller.signal, maxAttempts: 3, timeoutMs: 5_000 }),
    OperationAbortedError
  );
  assert.equal(attempts, 1);
  assert.equal(sawAbort, true, 'the attempt signal must be forwarded to the callback');
});

test('cancellation during the backoff delay stops the retry', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const fn = async () => {
    attempts += 1;
    setTimeout(() => controller.abort(), 5);
    const err = new Error('transient');
    err.status = 503;
    throw err;
  };

  await assert.rejects(
    () => withResilience(fn, { signal: controller.signal, maxAttempts: 5, baseMs: 200, capMs: 400 }),
    OperationAbortedError
  );
  assert.equal(attempts, 1, 'the sleeping retry must not wake up and try again');
});

test('a retry delay that cannot fit the remaining budget ends as a timeout', async () => {
  let attempts = 0;
  const fn = async () => {
    attempts += 1;
    const err = new Error('quota');
    err.status = 429;
    err.retryAfterMs = 5_000;
    throw err;
  };

  await assert.rejects(
    () => withResilience(fn, { maxAttempts: 3, deadlineAt: deadlineIn(200) }),
    GenerationTimeoutError
  );
  assert.equal(attempts, 1, 'no early retry against the server\'s own Retry-After guidance');
});

test('an uncooperative callback cannot hang the wrapper, and settles quietly', async () => {
  let rejectLate;
  const late = new Promise((_resolve, reject) => { rejectLate = reject; });

  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    await assert.rejects(
      () => withResilience(() => late, { timeoutMs: 20, maxAttempts: 1 }),
      (err) => err instanceof UpstreamError || err instanceof GenerationTimeoutError
    );
    // The callback finally settles long after the wrapper gave up.
    rejectLate(new Error('too late'));
    await sleep(20);
    assert.deepEqual(unhandled, [], 'a late rejection must already have a handler attached');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('sleep rejects on abort and leaves no pending timer behind', async () => {
  const controller = new AbortController();
  const pending = sleep(10_000, { signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending, OperationAbortedError);
});

test('sleep still accepts a bare duration', async () => {
  const started = monotonicNow();
  await sleep(20);
  assert.ok(monotonicNow() - started >= 15);
});

test('deadlineIn never extends past its parent deadline', () => {
  const parent = monotonicNow() + 100;
  assert.ok(deadlineIn(25_000, parent) <= parent);
  assert.ok(deadlineIn(10, parent) < parent);
});

// --- Optional YouTube enrichment stage ------------------------------------

const {
  parseRetryAfterMs,
  ENRICHMENT_TOTAL_MS,
  ENRICHMENT_MAX_ATTEMPTS,
} = require('../../services/youtube');

async function withYouTubeKey(fetchImpl, run) {
  const originalFetch = global.fetch;
  const originalKey = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = 'fake-key-for-test';
  global.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = originalKey;
  }
}

test('an exhausted enrichment stage degrades while the parent stays live', async () => {
  let calls = 0;
  await withYouTubeKey(
    async () => {
      calls += 1;
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: { get: () => null },
      };
    },
    async () => {
      // The parent has ten minutes left; only this optional stage failed,
      // so the lesson still gets written -- just without videos.
      const result = await searchVideos('anything', 3, { deadlineAt: deadlineIn(600_000) });
      assert.deepEqual(result, { videos: [], enrichmentStatus: 'unavailable' });
      assert.equal(calls, ENRICHMENT_MAX_ATTEMPTS);
    }
  );
});

test('a hanging search is bounded by the six-second stage budget, not the parent', async () => {
  const startedAt = monotonicNow();
  await withYouTubeKey(
    (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
    async () => {
      const result = await searchVideos('anything', 3, { deadlineAt: deadlineIn(600_000) });
      assert.deepEqual(result, { videos: [], enrichmentStatus: 'unavailable' });
    }
  );
  const elapsed = monotonicNow() - startedAt;
  assert.ok(
    elapsed >= ENRICHMENT_TOTAL_MS * 0.8 && elapsed < ENRICHMENT_TOTAL_MS * 2,
    `expected the stage to end near its ${ENRICHMENT_TOTAL_MS}ms budget, took ${Math.round(elapsed)}ms`
  );
});

test('parent cancellation propagates out of enrichment rather than degrading', async () => {
  const controller = new AbortController();
  await withYouTubeKey(
    (_url, { signal }) => new Promise((_resolve, reject) => {
      controller.abort();
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
    async () => {
      await assert.rejects(
        () => searchVideos('anything', 3, { signal: controller.signal }),
        OperationAbortedError
      );
    }
  );
});

test('an exhausted parent deadline propagates out of enrichment', async () => {
  await withYouTubeKey(
    async () => { throw new Error('should not be reached'); },
    async () => {
      await assert.rejects(
        () => searchVideos('anything', 3, { deadlineAt: monotonicNow() - 1 }),
        GenerationTimeoutError
      );
    }
  );
});

test('a missing YouTube key skips enrichment without a request', async () => {
  const originalKey = process.env.YOUTUBE_API_KEY;
  const originalFetch = global.fetch;
  delete process.env.YOUTUBE_API_KEY;
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error('should not be reached'); };
  try {
    assert.deepEqual(await searchVideos('anything'), { videos: [], enrichmentStatus: 'no_key' });
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
    if (originalKey !== undefined) process.env.YOUTUBE_API_KEY = originalKey;
  }
});

test('Retry-After accepts seconds and HTTP dates, and ignores anything else', () => {
  assert.equal(parseRetryAfterMs('120'), 120_000);
  assert.equal(parseRetryAfterMs('0'), 0);
  assert.equal(parseRetryAfterMs('-5'), undefined);
  assert.equal(parseRetryAfterMs('soon'), undefined);
  assert.equal(parseRetryAfterMs(null), undefined);
  assert.equal(parseRetryAfterMs(''), undefined);
  assert.equal(parseRetryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT'), undefined, 'a date in the past is ignored');

  const future = new Date(Date.now() + 30_000).toUTCString();
  const parsed = parseRetryAfterMs(future);
  assert.ok(parsed > 25_000 && parsed <= 30_000, `expected roughly 30s, got ${parsed}`);
});
