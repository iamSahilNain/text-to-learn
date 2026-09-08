'use strict';

const { ConfigurationError } = require('../utils/errors');

const PROVIDERS = {
  gemini: { keyName: 'GEMINI_API_KEY', modelName: 'GEMINI_MODEL', defaultModel: 'gemini-2.5-flash',
    stageMs: 25_000, attemptMs: 10_000, outlineMs: 35_000, lessonMs: 35_000 },
  deepseek: { keyName: 'DEEPSEEK_API_KEY', modelName: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-v4-flash',
    stageMs: 90_000, attemptMs: 40_000, outlineMs: 100_000, lessonMs: 110_000 },
};

function getProviderConfig() {
  const name = process.env.AI_PROVIDER || 'gemini';
  const config = PROVIDERS[name];
  if (!Object.hasOwn(PROVIDERS, name)) throw new ConfigurationError('AI_PROVIDER must be gemini or deepseek');
  return { name, ...config, model: process.env[config.modelName] || config.defaultModel };
}

module.exports = { getProviderConfig };
