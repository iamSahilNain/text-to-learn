'use strict';

// The public error table. Every branch must produce a fixed public message:
// no SDK text, no Mongoose text, no client input echoed back.

const test = require('node:test');
const assert = require('node:assert');

const { normalizeError, HttpError, ConfigurationError, PUBLIC_MESSAGES } = require('../../utils/errors');
const {
  UpstreamError,
  OperationAbortedError,
  GenerationTimeoutError,
} = require('../../services/resilience');

test('typed HTTP errors keep their own status, code and message', () => {
  assert.deepEqual(normalizeError(new HttpError(400, 'invalid_topic', 'Topic is required')), {
    status: 400, code: 'invalid_topic', message: 'Topic is required', retriable: false,
  });
  assert.deepEqual(normalizeError(new HttpError(404, 'not_found', 'Lesson not found')), {
    status: 404, code: 'not_found', message: 'Lesson not found', retriable: false,
  });
});

test('a missing configuration is a non-retriable 503', () => {
  const result = normalizeError(new ConfigurationError('GEMINI_API_KEY is not set'));
  assert.deepEqual(result, {
    status: 503, code: 'service_unavailable', message: PUBLIC_MESSAGES.service_unavailable, retriable: false,
  });
  assert.equal(result.message.includes('GEMINI_API_KEY'), false, 'configuration names stay server-side');
});

test('cancellation and deadline exhaustion are a retriable 504', () => {
  for (const err of [new GenerationTimeoutError(), new OperationAbortedError()]) {
    assert.deepEqual(normalizeError(err), {
      status: 504, code: 'generation_timeout', message: PUBLIC_MESSAGES.generation_timeout, retriable: true,
    });
  }
});

test('an upstream failure keeps the typed error\'s own retriable flag', () => {
  const forbidden = new UpstreamError('Upstream call failed: 403 Forbidden https://api.example/v1?key=SECRET', {
    status: 403, retriable: false, attempts: 1,
  });
  const result = normalizeError(forbidden);
  assert.deepEqual(result, {
    status: 502, code: 'upstream_unavailable', message: PUBLIC_MESSAGES.upstream_unavailable, retriable: false,
  });
  assert.equal(result.message.includes('SECRET'), false, 'an SDK message never reaches the envelope');

  const overloaded = new UpstreamError('overloaded', { status: 503, retriable: true, attempts: 3 });
  assert.equal(normalizeError(overloaded).retriable, true);
});

test('a malformed ObjectId is a 400 that does not echo the value back', () => {
  const cast = new Error('Cast to ObjectId failed for value "<img src=x>" at path "_id"');
  cast.name = 'CastError';
  cast.value = '<img src=x>';
  const result = normalizeError(cast);
  assert.deepEqual(result, {
    status: 400, code: 'bad_id', message: PUBLIC_MESSAGES.bad_id, retriable: false,
  });
  assert.equal(result.message.includes('img'), false);
});

test('body-parser failures are recognised by type, not by a trusted status', () => {
  const parseFailure = Object.assign(new Error('Unexpected token }'), { type: 'entity.parse.failed', status: 400 });
  assert.equal(normalizeError(parseFailure).code, 'invalid_json');
  assert.equal(normalizeError(parseFailure).status, 400);

  const tooLarge = Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413 });
  assert.equal(normalizeError(tooLarge).code, 'request_too_large');
  assert.equal(normalizeError(tooLarge).status, 413);

  // An arbitrary exception carrying a status is not treated as a client error.
  const impostor = Object.assign(new Error('boom'), { status: 400 });
  assert.equal(normalizeError(impostor).code, 'internal_error');
  assert.equal(normalizeError(impostor).status, 500);
});

test('an unexpected database failure is a retriable 500 with a fixed message', () => {
  const mongoFailure = Object.assign(new Error('E11000 duplicate key error collection: text_to_learn.courses'), {
    name: 'MongoServerError',
  });
  assert.deepEqual(normalizeError(mongoFailure), {
    status: 500, code: 'internal_error', message: PUBLIC_MESSAGES.internal_error, retriable: true,
  });
});
