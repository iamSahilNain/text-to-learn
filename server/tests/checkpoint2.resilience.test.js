'use strict';

// ============================================================================
// LEARNING CHECKPOINT #2 — External-API resilience (Gemini + YouTube)
// ----------------------------------------------------------------------------
// SKIPPED specs describing the hardened behaviour to build around the two
// external calls: Gemini (services/gemini.js) and YouTube (services/youtube.js).
// Today both are a single call with at most a basic try/catch.
//
// Remove `{ skip: ... }` and implement to activate.
// See LEARNING.md → Checkpoint 2 for hints and reading.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');

const SKIP = { skip: 'LEARNING CHECKPOINT #2 — implement resilience layer' };

test('a slow call is aborted at the timeout instead of hanging', SKIP, () => {
  // Wrap the fetch / SDK call so it rejects with a timeout error after N ms
  // (AbortController). Assert it does not wait indefinitely.
  assert.fail('not implemented');
});

test('transient failures retry with exponential backoff + jitter', SKIP, () => {
  // Simulate 2 failures then success. Assert the call eventually succeeds and
  // that the delay between attempts grows (and is jittered, not constant).
  assert.fail('not implemented');
});

test('a 429 / quota response is handled differently from a 500', SKIP, () => {
  // Quota/rate-limit errors should NOT be hammered with immediate retries —
  // respect Retry-After or back off hard. Assert the retry policy differs.
  assert.fail('not implemented');
});

test('the call gives up after a max attempt count with a typed error', SKIP, () => {
  // After exhausting retries, surface a single, typed error (not a raw fetch
  // rejection). Assert the attempt count is bounded.
  assert.fail('not implemented');
});

test('lesson generation succeeds even when YouTube enrichment fails', SKIP, () => {
  // Graceful degradation: if YouTube is down / quota-exhausted, the lesson is
  // still saved with content and videos:[]. Assert generation resolves and the
  // failure is observable (e.g. an enrichmentStatus flag) rather than silent.
  assert.fail('not implemented');
});
