'use strict';

const { withResilience } = require('./resilience');
const { ConfigurationError } = require('../utils/errors');
const { getProviderConfig } = require('./modelProvider');

function retryAfterMs(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function callDeepSeek(prompt, { signal, deadlineAt } = {}) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new ConfigurationError('DEEPSEEK_API_KEY is not set');
  const config = getProviderConfig();
  return withResilience(async (attemptSignal) => {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', signal: attemptSignal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        max_tokens: 8192,
        stream: false,
      }),
    });
    if (!response.ok) {
      // Do not read or propagate provider error bodies: they may contain input.
      await response.body?.cancel();
      const error = new Error(`DeepSeek HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfterMs = retryAfterMs(response.headers.get('retry-after'));
      throw error;
    }
    const body = await response.json();
    const choice = body?.choices?.[0];
    if (!choice || typeof choice.message?.content !== 'string') {
      const error = new Error('Invalid DeepSeek response envelope');
      error.status = 502;
      throw error;
    }
    // Incomplete output must enter validate/repair even if its prefix happens
    // to parse as a valid course. Never persist it as a ready result.
    if (choice.finish_reason !== 'stop') return '';
    return choice.message.content;
  }, { timeoutMs: config.attemptMs, maxAttempts: 3, signal, deadlineAt });
}

module.exports = { callDeepSeek, retryAfterMs };
