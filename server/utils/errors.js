'use strict';

// Shared error envelope: { error: { code, message } } everywhere, per the
// build spec's REST conventions (400 bad input, 404 not found, 502 upstream
// LLM failure, 503 degraded, 500 unexpected).

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

// Express error-handling middleware (4-arg signature required by Express).
// Mount this last, after all routes.
function errorMiddleware(err, req, res, _next) {
  if (err instanceof HttpError) {
    return sendError(res, err.status, err.code, err.message);
  }
  // Mongoose bad ObjectId (e.g. /api/courses/not-an-id) -> 400, not 500.
  if (err.name === 'CastError') {
    return sendError(res, 400, 'bad_id', `Invalid id: ${err.value}`);
  }
  console.error(err);
  sendError(res, 500, 'internal_error', 'Something went wrong');
}

module.exports = { HttpError, sendError, errorMiddleware };
