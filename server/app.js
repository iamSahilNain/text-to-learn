'use strict';

// Assembles the Express application without connecting to MongoDB, loading
// dotenv, or listening. server.js owns those; tests call createApp directly
// with explicit overrides so they exercise the real handlers.

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
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
const { errorMiddleware, HttpError } = require('./utils/errors');

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

  app.disable('x-powered-by');
  const production = (dependencies.environment || process.env.NODE_ENV) === 'production';
  const clientOrigin = dependencies.clientOrigin || process.env.CLIENT_ORIGIN || DEFAULT_CLIENT_ORIGIN;
  const accessGate = createAccessGate(dependencies.auth || {
    username: process.env.APP_USERNAME, password: process.env.APP_PASSWORD,
  });
  if (production && !accessGate) throw new Error('Production requires APP_USERNAME and APP_PASSWORD');
  const staticDir = dependencies.staticDir || (production ? path.resolve(__dirname, '../client/dist') : null);
  if (staticDir && !fs.existsSync(path.join(staticDir, 'index.html'))) {
    throw new Error('Frontend build missing: run npm --prefix client run build');
  }
  const limiters = createRateLimiters(dependencies.rateLimits);

  app.get('/healthz', (req, res) => {
    const ready = dependencies.mongoose.connection?.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
  });
  if (accessGate) {
    app.use(accessGate);
    app.use((req, res, next) => {
      // Browser credentials are ambient: reject cross-origin mutations.
      const origin = req.get('origin');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && origin !== clientOrigin) {
        return next(new HttpError(403, 'forbidden', 'Cross-origin requests are not allowed'));
      }
      next();
    });
  }
  app.use(cors({ origin: clientOrigin }));
  app.use(express.json({ strict: false, limit: '100kb' }));
  app.use('/api', limiters.global);

  const routed = { ...wired, limiters };
  app.use('/api/courses', createCourseRouter(routed));
  app.use('/api/lessons', createLessonRouter(routed));

  app.use('/api', (req, res, next) => next(new HttpError(404, 'not_found', 'API route not found')));
  if (staticDir) {
    app.use(express.static(staticDir, { index: false }));
    app.get('/{*splat}', (req, res, next) => {
      if (path.extname(req.path) || !req.accepts('html')) return next();
      res.set('Cache-Control', 'no-store');
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => res.json({ message: 'Text-to-Learn backend is running' }));
  }

  // Shared error envelope { error: { code, message } }. Mounted last.
  app.use(errorMiddleware);

  return app;
}

module.exports = { createApp, DEFAULT_CLIENT_ORIGIN };
