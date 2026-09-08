'use strict';

// Assembles the Express application without connecting to MongoDB, loading
// dotenv, or listening. server.js owns those; tests call createApp directly
// with explicit overrides so they exercise the real handlers.

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const Course = require('./models/Course');
const Module = require('./models/Module');
const Lesson = require('./models/Lesson');
const { generateCourseSafe, generateLessonSafe } = require('./services/gemini');
const { searchVideos } = require('./services/youtube');
const { createLessonGenerator } = require('./services/lessonGeneration');
const { createAccessGate, createRateLimiters } = require('./middleware/accessControl');
const { createDefaultPdfDocument } = require('./services/pdf');
const { createCourseRouter } = require('./routes/courseRoutes');
const { createLessonRouter } = require('./routes/lessonRoutes');
const { errorMiddleware } = require('./utils/errors');

const DEFAULT_CLIENT_ORIGIN = 'http://localhost:5173';

// Behind a platform proxy (Render, Fly, a load balancer) req.ip is the
// proxy's address unless Express is told how many hops to trust. Getting
// this wrong in the permissive direction lets a client spoof its address
// and walk straight past the rate limiter, so it is opt-in and numeric.
function configureTrustProxy(app, value) {
  if (value === undefined || value === '') return;
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error('TRUST_PROXY must be a non-negative integer (the number of proxy hops to trust)');
  }
  app.set('trust proxy', hops);
}

function createApp(overrides = {}) {
  const dependencies = {
    mongoose,
    models: { Course, Module, Lesson },
    generateCourseSafe,
    generateLessonSafe,
    searchVideos,
    createPdfDocument: createDefaultPdfDocument,
    ...overrides,
  };

  // One generator instance, shared by the single-lesson route and the bulk
  // stream, so both persist identical fields.
  const lessonGenerator = dependencies.lessonGenerator || createLessonGenerator({
    generateLessonSafe: dependencies.generateLessonSafe,
    searchVideos: dependencies.searchVideos,
  });
  // Tests shorten these so cancellation behaviour can be checked without
  // waiting out a real ten-minute budget.
  const wired = { ...dependencies, lessonGenerator, timeouts: dependencies.timeouts || {} };

  const app = express();
  configureTrustProxy(app, process.env.TRUST_PROXY);

  const limiters = createRateLimiters(dependencies.rateLimits);
  // Set API_ACCESS_TOKEN on a deployed instance. Unset means no gate, which
  // is what local development and the test suite run with.
  const accessGate = createAccessGate(
    'accessToken' in dependencies ? dependencies.accessToken : process.env.API_ACCESS_TOKEN,
  );

  // Defaults to the Vite dev server's origin. A deployment must set
  // CLIENT_ORIGIN; reflecting any origin is not an acceptable default.
  app.use(cors({ origin: process.env.CLIENT_ORIGIN || DEFAULT_CLIENT_ORIGIN }));
  // strict:false lets a JSON primitive through to request-shape validation
  // instead of being rejected as a parse error.
  app.use(express.json({ strict: false, limit: '100kb' }));

  // Order matters: reject unauthorised callers before spending anything,
  // and count every /api request against the global budget.
  if (accessGate) app.use('/api', accessGate);
  app.use('/api', limiters.global);

  const routed = { ...wired, limiters };
  app.use('/api/courses', createCourseRouter(routed));
  app.use('/api/lessons', createLessonRouter(routed));

  app.get('/', (req, res) => {
    res.json({ message: 'Text-to-Learn backend is running' });
  });

  // Readiness, not liveness: the process can be up while the database is
  // unreachable, and in that state it cannot serve a single useful request.
  app.get('/healthz', (req, res) => {
    const ready = dependencies.mongoose.connection?.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
  });

  // Shared error envelope { error: { code, message } }. Mounted last.
  app.use(errorMiddleware);

  return app;
}

module.exports = { createApp, DEFAULT_CLIENT_ORIGIN };
