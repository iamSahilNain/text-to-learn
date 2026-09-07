'use strict';

// Starts a real Express server on an ephemeral loopback port so tests drive
// the production handlers over actual HTTP.

const { createApp } = require('../../../app');

async function startTestServer(overrides = {}) {
  const app = createApp(overrides);
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1');
    listening.once('listening', () => resolve(listening));
    listening.once('error', reject);
  });
  const { port } = server.address();
  return {
    app,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { startTestServer };
