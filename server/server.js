'use strict';

// Process bootstrap. Everything that is not "assemble the app" lives here:
// configuration, the database connection, listening, and shutdown.

require('dotenv').config();
const mongoose = require('mongoose');

const { createApp } = require('./app');

const { getProviderConfig } = require('./services/modelProvider');
const SERVER_SELECTION_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_PORT = 3001;
// Loopback by default. Serving a public interface is a deployment decision
// that has to be made explicitly with HOST.
const DEFAULT_HOST = '127.0.0.1';

async function start() {
  const requiredEnv = ['MONGO_URI', getProviderConfig().keyName];
  const required = process.env.NODE_ENV === 'production'
    ? [...requiredEnv, 'APP_USERNAME', 'APP_PASSWORD', 'CLIENT_ORIGIN'] : requiredEnv;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}. See server/.env.example.`);
    process.exit(1);
  }

  const app = createApp();
  const host = process.env.HOST || DEFAULT_HOST;
  const port = process.env.PORT === undefined ? DEFAULT_PORT : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');

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
  const server = app.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}`);
  });

  server.on('error', (error) => {
    console.error(`Listen failed (${error.code || error.name}).`);
    process.exit(1);
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
  start().catch((error) => {
    console.error(`Startup failed (${error.name}). Check deployment configuration and frontend build.`);
    process.exit(1);
  });
}

module.exports = { start };
