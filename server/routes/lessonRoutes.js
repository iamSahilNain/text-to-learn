const express = require('express');
const { sendError } = require('../utils/errors');
const { serializeLesson } = require('../services/generationStatus');
const { parseGenerationOptions } = require('../controllers/courseController');
const { createRequestContext } = require('../services/requestContext');
const { LESSON_OPERATION_TOTAL_MS } = require('../services/lessonGeneration');

// One lesson request: generation, enrichment and the checks around its
// single write.
const LESSON_REQUEST_TOTAL_MS = LESSON_OPERATION_TOTAL_MS;

function createLessonRouter({ models, lessonGenerator, timeouts = {} }) {
  const router = express.Router();
  const { Lesson, Module, Course } = models;
  const lessonTimeoutMs = timeouts.lessonMs ?? LESSON_REQUEST_TOTAL_MS;

  router.get('/:id', async (req, res, next) => {
    try {
      const lesson = await Lesson.findById(req.params.id);
      if (!lesson) return sendError(res, 404, 'not_found', 'Lesson not found');
      res.json(serializeLesson(lesson));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/generate', async (req, res, next) => {
    // Registered before the lookup, so a client that leaves mid-request
    // stops the generation rather than paying for it.
    const context = createRequestContext(req, res, { timeoutMs: lessonTimeoutMs });
    try {
      const options = parseGenerationOptions(req.body);

      const lesson = await Lesson.findById(req.params.id);
      if (!lesson) return sendError(res, 404, 'not_found', 'Lesson not found');

      const courseModule = await Module.findById(lesson.module);
      if (!courseModule) return sendError(res, 404, 'not_found', "Lesson's module not found");
      const course = await Course.findById(courseModule.course);
      if (!course) return sendError(res, 404, 'not_found', "Lesson's course not found");

      // Same shared path the bulk stream uses: a ready lesson is returned
      // untouched unless force is set, and a degraded one is regenerated.
      const { lesson: saved } = await lessonGenerator.generateAndPersistLesson({
        lesson,
        courseTitle: course.title,
        moduleTitle: courseModule.title,
        force: options.force,
        signal: context.signal,
        deadlineAt: context.deadlineAt,
      });

      context.complete();
      res.json(serializeLesson(saved));
    } catch (err) {
      next(err);
    } finally {
      context.dispose();
    }
  });

  return router;
}

module.exports = { createLessonRouter };
