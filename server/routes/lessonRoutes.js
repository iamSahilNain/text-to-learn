const express = require('express');
const router = express.Router();
const Lesson = require('../models/Lesson');
const Module = require('../models/Module');
const Course = require('../models/Course');
const { generateLessonSafe } = require('../services/gemini');
const { searchVideos } = require('../services/youtube');
const { sendError, HttpError } = require('../utils/errors');

router.get('/:id', async (req, res, next) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return sendError(res, 404, 'not_found', 'Lesson not found');
    res.json(lesson);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/generate', async (req, res, next) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return sendError(res, 404, 'not_found', 'Lesson not found');

    const module = await Module.findById(lesson.module);
    if (!module) return sendError(res, 404, 'not_found', "Lesson's module not found");
    const course = await Course.findById(module.course);
    if (!course) return sendError(res, 404, 'not_found', "Lesson's course not found");

    const generated = await generateLessonSafe(course.title, module.title, lesson.title);

    lesson.objectives = generated.objectives || [];
    lesson.content = generated.content;

    // Enrich with YouTube videos. searchVideos() degrades to videos: [] on
    // any failure or when no API key is set (Checkpoint 2), and reports
    // *why* via enrichmentStatus so the caller can tell "no results" apart
    // from "the API was unavailable" instead of both silently being [].
    const { videos, enrichmentStatus } = await searchVideos(`${course.title} ${lesson.title} tutorial`);
    lesson.videos = videos;
    lesson.enrichmentStatus = enrichmentStatus;

    lesson.isEnriched = true;
    await lesson.save();

    res.json(lesson);
  } catch (err) {
    if (err instanceof HttpError) return next(err);
    console.error(err);
    sendError(res, 502, 'generation_failed', 'Failed to generate lesson content');
  }
});

module.exports = router;