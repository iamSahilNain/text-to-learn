'use strict';

// Bootstrap behaviour, checked in isolated child processes because it ends
// in process.exit.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { testDatabaseUri } = require('./helpers/database');

const SERVER_PATH = path.join(__dirname, '..', '..', 'server.js');

// dotenv would otherwise load the developer's own server/.env over these.
function runServer(env, { killAfterMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER_PATH], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    let timer = null;
    if (killAfterMs !== undefined) {
      timer = setTimeout(() => child.kill('SIGTERM'), killAfterMs);
    }

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test('a missing required variable exits nonzero without listening', async () => {
  const result = await runServer({ MONGO_URI: '', GEMINI_API_KEY: '' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Missing required environment variables: MONGO_URI, GEMINI_API_KEY/);
  assert.equal(result.stdout.includes('Server running'), false);
});

test('an unreachable database exits nonzero and never advertises readiness', async () => {
  const result = await runServer({
    // Port 1 refuses connections; server selection gives up after 5s.
    MONGO_URI: 'mongodb://127.0.0.1:1/text_to_learn_test?directConnection=true',
    GEMINI_API_KEY: 'fake-key-for-test',
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /MongoDB connection failed/);
  assert.equal(result.stdout.includes('Server running'), false);
  assert.equal(
    /mongodb:\/\/127\.0\.0\.1:1/.test(result.stderr),
    false,
    'the connection string is never echoed'
  );
});

test('a healthy start listens on loopback and shuts down cleanly on SIGTERM', async () => {
  const result = await runServer({
    MONGO_URI: testDatabaseUri(),
    GEMINI_API_KEY: 'fake-key-for-test',
    PORT: '0',
    HOST: '127.0.0.1',
  }, { killAfterMs: 1_500 });

  assert.match(result.stdout, /Server running on http:\/\/127\.0\.0\.1:/);
  assert.match(result.stdout, /Received SIGTERM, shutting down\./);
  assert.equal(result.code, 0, `expected a clean exit, got code=${result.code} signal=${result.signal}`);
});


test('DeepSeek startup requires its key instead of the Gemini key', async () => {
  const missing = await runServer({ AI_PROVIDER: 'deepseek', MONGO_URI: 'unused', DEEPSEEK_API_KEY: '', GEMINI_API_KEY: '' });
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /Missing required environment variables: DEEPSEEK_API_KEY/);
  const healthy = await runServer({ AI_PROVIDER: 'deepseek', MONGO_URI: testDatabaseUri(),
    DEEPSEEK_API_KEY: 'fake-deepseek-key', GEMINI_API_KEY: '', PORT: '0', HOST: '127.0.0.1',
  }, { killAfterMs: 1500 });
  assert.match(healthy.stdout, /Server running/);
  assert.equal(healthy.code, 0);
});
