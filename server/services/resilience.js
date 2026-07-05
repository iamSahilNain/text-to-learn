'use strict';

// ============================================================================
// LEARNING CHECKPOINT #2 — External-API resilience (Gemini + YouTube)
// ----------------------------------------------------------------------------
// A reusable wrapper for any async external call: timeout (AbortController),
// retry with exponential backoff + full jitter, and a 429/quota-vs-5xx
// policy split. See LEARNING.md (Checkpoint 2) and
// server/tests/checkpoint2.resilience.test.js for the behaviour this builds.
// ============================================================================

// A single typed error the caller always gets instead of a raw fetch
// rejection / AbortError / SDK exception, so callers can branch on `.status`
// and `.retriable` instead of parsing messages.
class UpstreamError extends Error {
  constructor(message, { status, retriable = false, attempts, cause } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.retriable = retriable;
    this.attempts = attempts;
    if (cause) this.cause = cause;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exponential backoff with "full jitter" (AWS's canonical formula): the
// delay is a random value between 0 and min(cap, base * 2^attempt). Growth
// spreads retries out over time; the randomness stops many clients that
// failed together from retrying in lockstep (a "retry storm").
function backoffDelay(attempt, { baseMs = 300, capMs = 8_000 } = {}) {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.random() * exp;
}

// A transient network error or 5xx *wants* a retry. A non-429 4xx (bad
// request, auth failure, etc.) does not -- retrying it just repeats the same
// failure. 429 is retriable but handled with its own, much longer backoff
// below (see `withResilience`), since hammering a quota-exhausted API is the
// worst possible response to a 429.
function defaultIsRetriable(err) {
  if (err.name === 'AbortError' || /timeout/i.test(err.message || '')) return true;
  if (typeof err.status === 'number') {
    if (err.status === 429) return true;
    if (err.status >= 500) return true;
    return false;
  }
  // No status at all -- e.g. a network-level failure -- treat as transient.
  return true;
}

/**
 * Run `fn(signal)` with a timeout, retrying transient failures with backoff
 * + jitter, up to `maxAttempts` total attempts. Throws one `UpstreamError` if
 * every attempt fails; never lets a raw fetch/SDK exception escape.
 *
 * `fn` should throw an error carrying `.status` (HTTP status code) and,
 * optionally, `.retryAfterMs` (parsed from a `Retry-After` header) so this
 * wrapper can apply the 429-vs-5xx policy split. Errors with no `.status`
 * (network failures) are treated as transient.
 */
async function withResilience(fn, opts = {}) {
  const {
    timeoutMs = 15_000,
    maxAttempts = 3,
    baseMs = 300,
    capMs = 8_000,
    quotaBaseMs = baseMs * 6,
    quotaCapMs = capMs * 6,
    isRetriable = defaultIsRetriable,
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    try {
      const result = await fn(controller.signal, attempt);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const attemptsMade = attempt + 1;
      const isLastAttempt = attemptsMade >= maxAttempts;

      if (isLastAttempt || !isRetriable(err)) {
        throw new UpstreamError(
          `Upstream call failed after ${attemptsMade} attempt(s): ${err.message}`,
          { status: err.status, retriable: isRetriable(err), attempts: attemptsMade, cause: err }
        );
      }

      const isQuota = err.status === 429;
      const delay = isQuota
        ? (err.retryAfterMs ?? backoffDelay(attempt, { baseMs: quotaBaseMs, capMs: quotaCapMs }))
        : backoffDelay(attempt, { baseMs, capMs });
      await sleep(delay);
    }
  }
  // Unreachable (loop always throws or returns), but keeps the type checker
  // and linters happy.
  throw new UpstreamError(lastErr?.message || 'upstream call failed', { attempts: maxAttempts });
}

module.exports = { withResilience, UpstreamError, sleep, backoffDelay, defaultIsRetriable };
