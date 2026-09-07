'use strict';

const { streamCoursePdf } = require('../services/pdf');
const { sendError, HttpError } = require('../utils/errors');
const { serializeCourse, serializeModule, effectiveLessonStatus } = require('../services/generationStatus');

const MAX_TOPIC_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// A generation request body is either absent, `{}`, or `{ force: boolean }`.
// Anything else -- an array, an explicit null, an unknown key, a non-boolean
// force -- is a client mistake worth reporting rather than guessing at.
function parseGenerationOptions(body) {
  if (body === undefined) return { force: false };
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_request', 'Invalid request body');
  }
  for (const key of Object.keys(body)) {
    if (key !== 'force') throw new HttpError(400, 'invalid_request', 'Invalid request body');
  }
  if ('force' in body && typeof body.force !== 'boolean') {
    throw new HttpError(400, 'invalid_request', 'Invalid request body');
  }
  return { force: body.force === true };
}

function createCourseController({ mongoose, models, generateCourseSafe, lessonGenerator }) {
  const { Course, Module, Lesson } = models;

  function populatedCourse(id) {
    return Course.findById(id).populate({ path: 'modules', populate: { path: 'lessons' } });
  }

  async function createCourse(req, res, next) {
    try {
      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
      if (!topic) {
        return sendError(res, 400, 'invalid_topic', 'Topic is required');
      }
      if (topic.length > MAX_TOPIC_LENGTH) {
        return sendError(res, 400, 'invalid_topic', `Topic must be ${MAX_TOPIC_LENGTH} characters or fewer`);
      }

      // The model call happens before the transaction so the write phase
      // stays short-lived.
      const { value: generated, outlineStatus } = await generateCourseSafe(topic);

      const session = await mongoose.startSession();
      let course;
      try {
        await session.withTransaction(async () => {
          // Recreated on every attempt: withTransaction may replay this
          // callback, and reusing documents from a previous attempt would
          // carry its module references into the retry.
          [course] = await Course.create([{
            title: generated.title,
            description: generated.description,
            tags: generated.tags,
            outlineStatus,
            modules: []
          }], { session });

          for (const outlineModule of generated.modules) {
            const lessons = await Lesson.insertMany(
              outlineModule.lessons.map((title) => ({
                title,
                content: [],
                module: null,
                generationStatus: 'pending',
                enrichmentStatus: 'pending',
                isEnriched: false,
              })),
              { session }
            );

            const [createdModule] = await Module.create([{
              title: outlineModule.title,
              course: course._id,
              lessons: lessons.map((lesson) => lesson._id)
            }], { session });

            await Lesson.updateMany(
              { _id: { $in: lessons.map((lesson) => lesson._id) } },
              { module: createdModule._id },
              { session }
            );

            course.modules.push(createdModule._id);
          }

          await course.save({ session });
        });
      } finally {
        await session.endSession();
      }

      const populated = await populatedCourse(course._id);
      res.status(201).json(serializeCourse(populated));
    } catch (err) {
      next(err);
    }
  }

  async function getCourses(req, res, next) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));

      const courses = await Course.find()
        .select('title description tags modules outlineStatus createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      res.json(courses);
    } catch (err) {
      next(err);
    }
  }

  async function getCourse(req, res, next) {
    try {
      const course = await populatedCourse(req.params.id);
      if (!course) return sendError(res, 404, 'not_found', 'Course not found');
      res.json(serializeCourse(course));
    } catch (err) {
      next(err);
    }
  }

  async function exportCoursePdf(req, res, next) {
    try {
      const course = await populatedCourse(req.params.id);
      if (!course) return sendError(res, 404, 'not_found', 'Course not found');
      streamCoursePdf(course, res);
    } catch (err) {
      next(err);
    }
  }

  // Generates every not-yet-ready lesson, streaming one `module` event per
  // module once all of its lessons have been processed or skipped.
  async function generateCourseContent(req, res, next) {
    let options;
    let course;
    try {
      options = parseGenerationOptions(req.body);
      course = await populatedCourse(req.params.id);
      if (!course) return sendError(res, 404, 'not_found', 'Course not found');
    } catch (err) {
      return next(err);
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders?.();

    let clientClosed = false;
    req.on('close', () => { clientClosed = true; });

    function sendEvent(event, data) {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    try {
      for (const courseModule of course.modules) {
        if (clientClosed) break;

        for (const lesson of courseModule.lessons) {
          if (clientClosed) break;
          await lessonGenerator.generateAndPersistLesson({
            lesson,
            courseTitle: course.title,
            moduleTitle: courseModule.title,
            force: options.force,
          });
        }

        // Only emitted once every lesson in the module has been handled.
        if (!clientClosed) sendEvent('module', serializeModule(courseModule));
      }

      if (!clientClosed) sendEvent('done', summarize(course));
    } catch (err) {
      console.error('[generateCourseContent]', err.message);
      if (!clientClosed) sendEvent('error', { message: 'Generation failed' });
    } finally {
      res.end();
    }
  }

  // Counts cover the whole course, including lessons that were already ready
  // and therefore skipped, so ready + degraded always equals total.
  function summarize(course) {
    let readyLessons = 0;
    let degradedLessons = 0;
    let totalLessons = 0;
    for (const courseModule of course.modules) {
      for (const lesson of courseModule.lessons) {
        totalLessons += 1;
        const status = effectiveLessonStatus(lesson);
        if (status === 'ready') readyLessons += 1;
        else if (status === 'degraded') degradedLessons += 1;
      }
    }
    return {
      courseId: String(course._id),
      status: degradedLessons > 0 ? 'degraded' : 'complete',
      readyLessons,
      degradedLessons,
      totalLessons,
    };
  }

  return { createCourse, getCourses, getCourse, exportCoursePdf, generateCourseContent };
}

module.exports = { createCourseController, parseGenerationOptions, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
