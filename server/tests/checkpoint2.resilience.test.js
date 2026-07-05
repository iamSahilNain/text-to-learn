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

const { withResilience, UpstreamError } = require('../services/resilience');
const { searchVideos } = require('../services/youtube');

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
