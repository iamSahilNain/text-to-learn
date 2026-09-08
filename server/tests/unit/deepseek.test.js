'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.AI_PROVIDER = 'deepseek';
process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
delete process.env.GEMINI_API_KEY;
const { generateCourseSafe, generateLessonSafe } = require('../../services/gemini');
const { getProviderConfig } = require('../../services/modelProvider');
const { retryAfterMs } = require('../../services/deepseek');
const { ConfigurationError, normalizeError } = require('../../utils/errors');
const { UpstreamError, GenerationTimeoutError, OperationAbortedError, deadlineIn } = require('../../services/resilience');
const course = { title: 'Rust', description: 'Learn Rust', tags: ['rust'], modules: [{ title: 'Basics', lessons: ['One', 'Two', 'Three'] }] };
const lesson = { title: 'One', objectives: [], content: [{ type: 'paragraph', text: 'Body' }] };
const completion = (value, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }), { status: 200 });
async function transport(handler, run) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => { calls.push({ url, init }); return handler(calls.length, init); };
  try { await run(calls); } finally { global.fetch = original; }
}

test('DeepSeek generates a validated outline without a Gemini key', async () => {
  await transport(() => completion(course), async calls => {
    assert.equal((await generateCourseSafe('Rust')).outlineStatus, 'ready');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-deepseek-key');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, 'deepseek-v4-flash');
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.max_tokens, 8192);
    assert.equal(body.stream, false);
    assert.match(body.messages[0].content, /JSON/);
  });
});

test('DeepSeek generates a validated lesson', async () => {
  await transport(() => completion(lesson), async () => {
    assert.equal((await generateLessonSafe('Rust', 'Basics', 'One')).generationStatus, 'ready');
  });
});

for (const first of ['', '{broken', { title: 'schema invalid' }]) {
  test(`invalid content gets one repair: ${JSON.stringify(first)}`, async () => {
    await transport(n => completion(n === 1 ? first : course), async calls => {
      assert.equal((await generateCourseSafe('Rust')).outlineStatus, 'ready');
      assert.equal(calls.length, 2);
    });
  });
}

test('length finish reason rejects even valid JSON and falls back after one repair', async () => {
  await transport(() => completion(course, 'length'), async calls => {
    assert.equal((await generateCourseSafe('Rust')).outlineStatus, 'degraded');
    assert.equal(calls.length, 2);
  });
});

for (const status of [400, 401, 402, 403, 422]) {
  test(`HTTP ${status} is not retried or turned into generated content`, async () => {
    await transport(() => new Response('private provider error', { status }), async calls => {
      await assert.rejects(() => generateCourseSafe('Rust'), error => {
        assert.ok(error instanceof UpstreamError);
        assert.equal(error.status, status);
        assert.equal(error.retriable, false);
        assert.equal(normalizeError(error).message, 'Generation provider is unavailable');
        assert.ok(!error.message.includes('private provider error'));
        return true;
      });
      assert.equal(calls.length, 1);
    });
  });
}
for (const status of [429, 503]) {
  test(`HTTP ${status} retries and recovers`, async () => {
    await transport(n => n === 1 ? new Response('', { status, headers: { 'Retry-After': '0' } }) : completion(course), async calls => {
      assert.equal((await generateCourseSafe('Rust')).outlineStatus, 'ready');
      assert.equal(calls.length, 2);
    });
  });
}

test('Retry-After beyond the shared deadline prevents another call', async () => {
  await transport(() => new Response('', { status: 429, headers: { 'Retry-After': '120' } }), async calls => {
    await assert.rejects(() => generateCourseSafe('Rust', { deadlineAt: deadlineIn(1000) }), GenerationTimeoutError);
    assert.equal(calls.length, 1);
  });
});

test('deadline cancels a stalled response body and does not retry', async () => {
  let observedSignal;
  await transport((_n, init) => {
    observedSignal = init.signal;
    return { ok: true, json: () => new Promise(() => {}) };
  }, async calls => {
    await assert.rejects(() => generateCourseSafe('Rust', { deadlineAt: deadlineIn(30) }), GenerationTimeoutError);
    assert.equal(observedSignal.aborted, true);
    assert.equal(calls.length, 1);
  });
});

test('client cancellation aborts the transport with no later attempt', async () => {
  const controller = new AbortController();
  await transport((_n, init) => {
    controller.abort();
    assert.equal(init.signal.aborted, true);
    return new Promise(() => {});
  }, async calls => {
    await assert.rejects(() => generateCourseSafe('Rust', { signal: controller.signal }), OperationAbortedError);
    assert.equal(calls.length, 1);
  });
});

test('missing DeepSeek key fails before any network request', async () => {
  delete process.env.DEEPSEEK_API_KEY;
  try {
    await transport(() => { throw new Error('unexpected network'); }, async calls => {
      await assert.rejects(() => generateCourseSafe('Rust'), ConfigurationError);
      assert.equal(calls.length, 0);
    });
  } finally { process.env.DEEPSEEK_API_KEY = 'test-deepseek-key'; }
});

test('provider budgets leave room for model work and persistence', () => {
  const config = getProviderConfig();
  assert.equal(config.stageMs, 90000);
  assert.ok(config.attemptMs < config.stageMs);
  assert.ok(config.outlineMs > config.stageMs);
  assert.ok(config.lessonMs > config.stageMs);
  assert.equal(retryAfterMs('2'), 2000);
  assert.equal(retryAfterMs('invalid'), undefined);
  process.env.AI_PROVIDER = 'unknown';
  try { assert.throws(getProviderConfig, ConfigurationError); }
  finally { process.env.AI_PROVIDER = 'deepseek'; }
});
