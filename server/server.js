'use strict';

// Process bootstrap. Everything that is not "assemble the app" lives here:
// configuration, the database connection, listening, and shutdown.

require('dotenv').config();
const mongoose = require('mongoose');

const { createApp } = require('./app');

const REQUIRED_ENV = ['MONGO_URI', 'GEMINI_API_KEY'];
const SERVER_SELECTION_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_PORT = 3001;
// Loopback by default. Serving a public interface is a deployment decision
// that has to be made explicitly with HOST.
const DEFAULT_HOST = '127.0.0.1';

async function start() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}. See server/.env.example.`);
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    });
  } catch (err) {
    // Never the raw message: a connection error echoes the URI, credentials
    // included.
    console.error(`MongoDB connection failed (${err.name}). Check MONGO_URI in server/.env.`);
    process.exit(1);
  }

  // Only now: a server that accepts requests before its database is
  // reachable advertises a readiness it does not have.
  const app = createApp();
  const host = process.env.HOST || DEFAULT_HOST;
  const port = Number(process.env.PORT) || DEFAULT_PORT;

  const server = app.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}`);
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down.`);

    const forced = setTimeout(() => {
      console.error('Shutdown exceeded its window; exiting.');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forced.unref();

    try {
      await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect();
      clearTimeout(forced);
      process.exit(0);
    } catch (err) {
      console.error(`Shutdown failed (${err.name}).`);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  start();
}

module.exports = { start };
