const express = require('express');
const { sendError } = require('../utils/errors');
const { serializeLesson } = require('../services/generationStatus');
const { parseGenerationOptions } = require('../controllers/courseController');
const { createRequestContext } = require('../services/requestContext');
const { LESSON_OPERATION_TOTAL_MS } = require('../services/lessonGeneration');

// One lesson request: generation, enrichment and the checks around its
// single write.
const LESSON_REQUEST_TOTAL_MS = LESSON_OPERATION_TOTAL_MS;
// Bounds the additive module lookup below so a stalled database cannot hang
// an otherwise-ordinary lesson read.
const MODULE_LOOKUP_TIMEOUT_MS = 5_000;

function createLessonRouter({ models, lessonGenerator, timeouts = {}, limiters }) {
  const router = express.Router();
  const limitGeneration = limiters?.generation ?? ((req, res, next) => next());
  const { Lesson, Module, Course } = models;
  const lessonTimeoutMs = timeouts.lessonMs ?? LESSON_REQUEST_TOTAL_MS;

  router.get('/:id', async (req, res, next) => {
    try {
      const lesson = await Lesson.findById(req.params.id);
      if (!lesson) return sendError(res, 404, 'not_found', 'Lesson not found');
      const serialized = serializeLesson(lesson);
      // Additive only: a narrow, bounded read of the lesson's own module so
      // the client can build a deterministic parent-course link without a
      // second, unauthenticated lookup. The existing module field is
      // untouched.
      const courseModule = await Module.findById(lesson.module)
        .select('course')
        .maxTimeMS(MODULE_LOOKUP_TIMEOUT_MS);
      if (courseModule?.course) serialized.courseId = String(courseModule.course);
      res.json(serialized);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/generate', limitGeneration, async (req, res, next) => {
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
      // Same additive field the GET route carries: course._id is already in
      // hand here, so this is not a second lookup. Without it, a client that
      // replaces its lesson with this response loses the parent-course link
      // it started with.
      res.json({ ...serializeLesson(saved), courseId: String(course._id) });
    } catch (err) {
      next(err);
    } finally {
      context.dispose();
    }
  });

  return router;
}

module.exports = { createLessonRouter };
