'use strict';

// One place that turns any internal failure into a public
// { error: { code, message } } envelope. Raw SDK, driver and Mongoose
// messages never reach a client, and the same classification backs both
// JSON responses and terminal SSE error events.

const {
  UpstreamError,
  OperationAbortedError,
  GenerationTimeoutError,
} = require('../services/resilience');

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

// Required configuration is missing. Not the client's fault and not worth
// retrying until an operator changes something.
class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
    this.code = 'service_unavailable';
  }
}

const PUBLIC_MESSAGES = {
  bad_id: 'Invalid resource ID',
  invalid_request: 'Invalid request body',
  invalid_json: 'Request body must be valid JSON',
  invalid_pagination: 'page and limit must be valid positive integers',
  request_too_large: 'Request body exceeds 100 KB',
  service_unavailable: 'Generation is not configured',
  upstream_unavailable: 'Generation provider is unavailable',
  generation_timeout: 'Generation timed out. Retry to continue.',
  internal_error: 'Something went wrong',
};

// Codes a client can usefully retry without changing anything first.
const RETRIABLE_CODES = new Set(['generation_timeout', 'internal_error']);

/**
 * Classify any error into { status, code, message, retriable }.
 * Messages are fixed public strings except for the route-specific
 * invalid_topic and not_found texts, which are already safe.
 */
function normalizeError(err) {
  if (err instanceof HttpError) {
    return {
      status: err.status,
      code: err.code,
      message: err.message,
      retriable: RETRIABLE_CODES.has(err.code),
    };
  }

  if (err instanceof ConfigurationError) {
    return { status: 503, code: 'service_unavailable', message: PUBLIC_MESSAGES.service_unavailable, retriable: false };
  }

  if (err instanceof GenerationTimeoutError || err instanceof OperationAbortedError) {
    return { status: 504, code: 'generation_timeout', message: PUBLIC_MESSAGES.generation_timeout, retriable: true };
  }

  if (err instanceof UpstreamError) {
    // A 403 wrapped as a 502 is still not worth retrying.
    return {
      status: 502,
      code: 'upstream_unavailable',
      message: PUBLIC_MESSAGES.upstream_unavailable,
      retriable: err.retriable === true,
    };
  }

  // Malformed ObjectId. Only the category is reported: err.value is client
  // input and is never echoed back.
  if (err?.name === 'CastError') {
    return { status: 400, code: 'bad_id', message: PUBLIC_MESSAGES.bad_id, retriable: false };
  }

  // Specific body-parser failures, recognised by type rather than by
  // trusting an arbitrary error.status from any exception.
  if (err?.type === 'entity.parse.failed') {
    return { status: 400, code: 'invalid_json', message: PUBLIC_MESSAGES.invalid_json, retriable: false };
  }
  if (err?.type === 'entity.too.large') {
    return { status: 413, code: 'request_too_large', message: PUBLIC_MESSAGES.request_too_large, retriable: false };
  }

  return { status: 500, code: 'internal_error', message: PUBLIC_MESSAGES.internal_error, retriable: true };
}

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

// Server-side logging of a classified failure. Never logs the raw error:
// SDK errors carry request URLs and keys.
function logError(scope, err) {
  const { code, status } = normalizeError(err);
  console.error(JSON.stringify({ scope, status, code, error: err?.name || 'Error' }));
}

// Express error-handling middleware. Mount last, after all routes.
function errorMiddleware(err, req, res, next) {
  const { status, code, message } = normalizeError(err);
  logError(req.method + ' ' + req.path, err);

  // Headers already went out (a stream, typically): there is no second
  // response to send.
  if (res.headersSent) return next(err);
  if (res.destroyed || !res.writable) return;

  sendError(res, status, code, message);
}

module.exports = {
  HttpError,
  ConfigurationError,
  PUBLIC_MESSAGES,
  normalizeError,
  sendError,
  logError,
  errorMiddleware,
};
