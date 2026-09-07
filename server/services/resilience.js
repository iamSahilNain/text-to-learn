'use strict';

// Retry, timeout and cancellation for external calls.
//
// Every caller shares this wrapper: there is no second retry implementation
// anywhere in the server. Callers supply an external abort signal and an
// absolute monotonic deadline; both are re-checked at entry, before each
// attempt, and on both sides of every backoff sleep.

const { performance } = require('node:perf_hooks');

// The caller cancelled -- a client disconnect, or a parent operation giving
// up. This always wins over retry classification.
class OperationAbortedError extends Error {
  constructor(message = 'Operation was aborted') {
    super(message);
    this.name = 'OperationAbortedError';
    this.code = 'operation_aborted';
  }
}

// The operation's own budget ran out.
class GenerationTimeoutError extends Error {
  constructor(message = 'Operation exceeded its time budget') {
    super(message);
    this.name = 'GenerationTimeoutError';
    this.code = 'generation_timeout';
  }
}

// One attempt exceeded its slice. Retryable while the parent budget is live.
class AttemptTimeoutError extends Error {
  constructor(ms) {
    super(`Attempt timed out after ${ms}ms`);
    this.name = 'AttemptTimeoutError';
    this.retriable = true;
  }
}

// The typed error callers branch on instead of parsing SDK messages.
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

function monotonicNow() {
  return performance.now();
}

// An absolute monotonic deadline `totalMs` from now, never later than the
// parent's own deadline.
function deadlineIn(totalMs, parentDeadlineAt) {
  const own = monotonicNow() + totalMs;
  return parentDeadlineAt === undefined ? own : Math.min(own, parentDeadlineAt);
}

function remainingMs(deadlineAt) {
  return deadlineAt === undefined ? Infinity : deadlineAt - monotonicNow();
}

function throwIfSettled(signal, deadlineAt) {
  if (signal?.aborted) throw new OperationAbortedError();
  if (remainingMs(deadlineAt) <= 0) throw new GenerationTimeoutError();
}

// Abortable delay. Existing callers that pass only a duration keep working.
function sleep(ms, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OperationAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    function onAbort() {
      cleanup();
      reject(new OperationAbortedError());
    }
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Exponential backoff with full jitter: a random delay in [0, min(cap,
// base * 2^attempt)). The randomness keeps clients that failed together
// from retrying in lockstep.
function backoffDelay(attempt, { baseMs = 300, capMs = 8_000 } = {}) {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.random() * exp;
}

// A non-429 4xx will fail the same way on a second attempt. 429 gets its own
// much longer delay in the loop below, because hammering a rate-limited API
// is the worst available response to a 429.
function defaultIsRetriable(err) {
  if (err?.retriable === true) return true;
  if (err?.name === 'AbortError') return true;
  if (typeof err?.status === 'number') {
    if (err.status === 429) return true;
    return err.status >= 500;
  }
  // No status at all -- a network-level failure -- is treated as transient.
  return true;
}

// Runs one attempt under a signal combining external cancellation, the
// overall deadline and this attempt's own slice.
async function runAttempt(fn, attemptIndex, { signal, deadlineAt, timeoutMs }) {
  const controller = new AbortController();
  const budgetMs = remainingMs(deadlineAt);
  const attemptMs = Math.min(timeoutMs, budgetMs);
  let cause = budgetMs < timeoutMs ? 'deadline' : 'attempt';

  const timer = setTimeout(() => controller.abort(), attemptMs);
  function onExternalAbort() {
    cause = 'external';
    controller.abort();
  }
  signal?.addEventListener('abort', onExternalAbort, { once: true });

  const aborted = new Promise((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => {
      if (cause === 'external') reject(new OperationAbortedError());
      else if (cause === 'deadline') reject(new GenerationTimeoutError());
      else reject(new AttemptTimeoutError(Math.round(attemptMs)));
    }, { once: true });
  });

  // Bounded race: an uncooperative callback that ignores its signal cannot
  // hang the wrapper, and its late rejection is always consumed.
  const work = Promise.resolve().then(() => fn(controller.signal, attemptIndex));
  work.catch(() => {});

  try {
    return await Promise.race([work, aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Run `fn(attemptSignal, attemptIndex)` with per-attempt timeouts, retrying
 * transient failures with backoff and jitter inside the supplied budget.
 *
 * Throws OperationAbortedError on external cancellation, GenerationTimeoutError
 * when the deadline wins, and a single UpstreamError when every attempt
 * failed. Never lets a raw SDK or fetch exception escape.
 *
 * `fn` should throw errors carrying `.status`, and optionally `.retryAfterMs`
 * parsed from a Retry-After header, so the 429-versus-5xx split applies.
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
    signal,
    deadlineAt,
  } = opts;

  // An already-cancelled or already-expired call must not start paid work.
  throwIfSettled(signal, deadlineAt);

  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    throwIfSettled(signal, deadlineAt);
    try {
      return await runAttempt(fn, attempt, { signal, deadlineAt, timeoutMs });
    } catch (err) {
      if (err instanceof OperationAbortedError || err instanceof GenerationTimeoutError) throw err;
      // A callback that surfaced the cancellation as its own error still
      // means cancellation, not a retryable upstream failure.
      if (signal?.aborted) throw new OperationAbortedError();

      lastErr = err;
      const attemptsMade = attempt + 1;
      const retriable = isRetriable(err);
      if (attemptsMade >= maxAttempts || !retriable) {
        throw new UpstreamError(
          `Upstream call failed after ${attemptsMade} attempt(s): ${err.message}`,
          { status: err.status, retriable, attempts: attemptsMade, cause: err }
        );
      }

      const delay = err.status === 429
        ? (err.retryAfterMs ?? backoffDelay(attempt, { baseMs: quotaBaseMs, capMs: quotaCapMs }))
        : backoffDelay(attempt, { baseMs, capMs });

      // Rather than retry early against the server's own guidance, end the
      // stage with its deadline outcome when the delay cannot fit.
      if (delay >= remainingMs(deadlineAt)) throw new GenerationTimeoutError();

      await sleep(delay, { signal });
      throwIfSettled(signal, deadlineAt);
    }
  }

  throw new UpstreamError(lastErr?.message || 'upstream call failed', { attempts: maxAttempts });
}

module.exports = {
  withResilience,
  UpstreamError,
  OperationAbortedError,
  GenerationTimeoutError,
  AttemptTimeoutError,
  sleep,
  backoffDelay,
  defaultIsRetriable,
  monotonicNow,
  deadlineIn,
  remainingMs,
  throwIfSettled,
};
