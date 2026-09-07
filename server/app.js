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
const { createCourseRouter } = require('./routes/courseRoutes');
const { createLessonRouter } = require('./routes/lessonRoutes');
const { errorMiddleware } = require('./utils/errors');

function createApp(overrides = {}) {
  const dependencies = {
    mongoose,
    models: { Course, Module, Lesson },
    generateCourseSafe,
    generateLessonSafe,
    searchVideos,
    ...overrides,
  };

  // One generator instance, shared by the single-lesson route and the bulk
  // stream, so both persist identical fields.
  const lessonGenerator = dependencies.lessonGenerator || createLessonGenerator({
    generateLessonSafe: dependencies.generateLessonSafe,
    searchVideos: dependencies.searchVideos,
  });
  const wired = { ...dependencies, lessonGenerator };

  const app = express();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
  // strict:false lets a JSON primitive through to request-shape validation
  // instead of being rejected as a parse error.
  app.use(express.json({ strict: false, limit: '100kb' }));

  app.use('/api/courses', createCourseRouter(wired));
  app.use('/api/lessons', createLessonRouter(wired));

  app.get('/', (req, res) => {
    res.json({ message: 'Text-to-Learn backend is running' });
  });

  // Shared error envelope { error: { code, message } }. Mounted last.
  app.use(errorMiddleware);

  return app;
}

module.exports = { createApp };
