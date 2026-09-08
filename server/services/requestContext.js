'use strict';

// Ties one HTTP request to a cancellation signal and a wall-clock budget.
//
// Register it before the first await so a client that disappears during the
// initial lookup is still noticed. res.on('close') is the reliable
// disconnect signal: req 'close' can fire as soon as the request body has
// been consumed, long before the response is finished.

const { monotonicNow } = require('./resilience');

const CLIENT_DISCONNECTED = 'client_disconnected';
const DEADLINE_EXPIRED = 'deadline_expired';

function createRequestContext(req, res, { timeoutMs }) {
  const controller = new AbortController();
  const deadlineAt = monotonicNow() + timeoutMs;

  let reason = null;
  let completed = false;
  let disposed = false;

  function abortWith(nextReason) {
    if (completed || reason !== null) return;
    reason = nextReason;
    controller.abort();
  }

  const timer = setTimeout(() => abortWith(DEADLINE_EXPIRED), timeoutMs);
  const onResponseClose = () => abortWith(CLIENT_DISCONNECTED);
  const onRequestAborted = () => abortWith(CLIENT_DISCONNECTED);

  res.on('close', onResponseClose);
  req.on('aborted', onRequestAborted);

  return {
    signal: controller.signal,
    deadlineAt,
    // Reasons are read through these helpers rather than by matching an
    // abort message.
    clientDisconnected: () => reason === CLIENT_DISCONNECTED,
    deadlineExpired: () => reason === DEADLINE_EXPIRED,
    // Marks a normal terminal end so the close listener that fires as the
    // response finishes is not mistaken for the client leaving.
    complete() {
      completed = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      res.off('close', onResponseClose);
      req.off('aborted', onRequestAborted);
    },
  };
}

module.exports = { createRequestContext, CLIENT_DISCONNECTED, DEADLINE_EXPIRED };
