'use strict';

const { streamCoursePdf, createDefaultPdfDocument } = require('../services/pdf');
const { logOperation, startTimer, elapsedMsSince } = require('../utils/logging');
const { sendError, HttpError, normalizeError, logError, PUBLIC_MESSAGES } = require('../utils/errors');
const { serializeCourse, serializeModule, effectiveLessonStatus, effectiveOutlineStatus } = require('../services/generationStatus');
const { createRequestContext } = require('../services/requestContext');
const { monotonicNow, throwIfSettled, GenerationTimeoutError, OperationAbortedError } = require('../services/resilience');
const { LESSON_OPERATION_TOTAL_MS } = require('../services/lessonGeneration');

const MAX_TOPIC_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// One outline request, model stage and persistence checks together.
const OUTLINE_REQUEST_TOTAL_MS = 35_000;
// One full-course stream. On expiry the run stops starting work; lessons
// already saved stay saved and are skipped on the next attempt.
const BULK_REQUEST_TOTAL_MS = 600_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
// Bounds the initial resource read so a stalled database cannot outlive the
// request context silently.
const READ_MAX_TIME_MS = 5_000;
// Bounds the commit itself. It cannot undo a commit that already succeeded.
const COMMIT_MAX_TIME_MS = 5_000;

// Pagination values are accepted only as plain positive integers. A
// fractional page, an exponent, a garbage suffix, an unsafe integer, or a
// repeated query parameter (which Express hands over as an array) is a
// client mistake, not something to round into a default.
function parsePositiveInteger(raw, { min, max }) {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) {
    throw new HttpError(400, 'invalid_pagination', PUBLIC_MESSAGES.invalid_pagination);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
    throw new HttpError(400, 'invalid_pagination', PUBLIC_MESSAGES.invalid_pagination);
  }
  return value;
}

function parsePagination(query) {
  const page = parsePositiveInteger(query.page, { min: 1 }) ?? 1;
  const limit = parsePositiveInteger(query.limit, { min: 1, max: MAX_PAGE_SIZE }) ?? DEFAULT_PAGE_SIZE;
  const skip = (page - 1) * limit;
  // A page far enough out that its offset is no longer exactly
  // representable cannot be served correctly, so it is refused.
  if (!Number.isSafeInteger(skip)) {
    throw new HttpError(400, 'invalid_pagination', PUBLIC_MESSAGES.invalid_pagination);
  }
  return { page, limit, skip };
}

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

function createCourseController({
  mongoose,
  models,
  generateCourseSafe,
  lessonGenerator,
  createPdfDocument = createDefaultPdfDocument,
  timeouts = {},
}) {
  const { Course, Module, Lesson } = models;
  const outlineTimeoutMs = timeouts.outlineMs ?? OUTLINE_REQUEST_TOTAL_MS;
  const bulkTimeoutMs = timeouts.bulkMs ?? BULK_REQUEST_TOTAL_MS;

  function populatedCourse(id) {
    return Course.findById(id).populate({ path: 'modules', populate: { path: 'lessons' } });
  }

  async function readWithinRequest(query, context) {
    throwIfSettled(context.signal, context.deadlineAt);
    let onAbort;
    const aborted = new Promise((_resolve, reject) => {
      onAbort = () => reject(context.deadlineExpired()
        ? new GenerationTimeoutError()
        : new OperationAbortedError());
      context.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      // maxTimeMS bounds database work; this race also bounds the HTTP wait
      // and consumes a late rejection if the database outlives the request.
      const value = await Promise.race([Promise.resolve(query), aborted]);
      throwIfSettled(context.signal, context.deadlineAt);
      return value;
    } finally {
      context.signal.removeEventListener('abort', onAbort);
    }
  }

  async function createCourse(req, res, next) {
    const context = createRequestContext(req, res, { timeoutMs: outlineTimeoutMs });
    const startedAt = startTimer();
    try {
      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
      if (!topic) {
        return sendError(res, 400, 'invalid_topic', 'Topic is required');
      }
      if (topic.length > MAX_TOPIC_LENGTH) {
        return sendError(res, 400, 'invalid_topic', `Topic must be ${MAX_TOPIC_LENGTH} characters or fewer`);
      }

      // The model call happens before the transaction so the write phase
      // stays short-lived. Its budget does not bound the commit.
      const { value: generated, outlineStatus } = await generateCourseSafe(topic, {
        signal: context.signal,
        deadlineAt: context.deadlineAt,
      });

      throwIfSettled(context.signal, context.deadlineAt);

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
            // A cancellation between writes aborts the transaction. One that
            // arrives after the commit succeeded cannot undo it.
            throwIfSettled(context.signal, context.deadlineAt);

            // The module's id is allocated up front so each lesson can be
            // inserted already pointing at its module. That removes the
            // backfill pass that used to follow every module.
            const moduleId = new mongoose.Types.ObjectId();

            const lessons = await Lesson.insertMany(
              outlineModule.lessons.map((title) => ({
                title,
                content: [],
                module: moduleId,
                generationStatus: 'pending',
                enrichmentStatus: 'pending',
                isEnriched: false,
              })),
              { session }
            );

            const [createdModule] = await Module.create([{
              _id: moduleId,
              title: outlineModule.title,
              course: course._id,
              lessons: lessons.map((lesson) => lesson._id)
            }], { session });

            course.modules.push(createdModule._id);
          }

          throwIfSettled(context.signal, context.deadlineAt);
          await course.save({ session });
        }, { maxCommitTimeMS: COMMIT_MAX_TIME_MS });
      } finally {
        await session.endSession();
      }

      const populated = await populatedCourse(course._id);
      const serialized = serializeCourse(populated);
      logOperation({
        operation: 'course_create',
        status: serialized.outlineStatus,
        durationMs: elapsedMsSince(startedAt),
        modules: serialized.modules.length,
        lessons: serialized.modules.reduce((total, entry) => total + entry.lessons.length, 0),
      });
      context.complete();
      res.status(201).json(serialized);
    } catch (err) {
      next(err);
    } finally {
      context.dispose();
    }
  }

  async function getCourses(req, res, next) {
    try {
      const { page, limit, skip } = parsePagination(req.query);

      // One extra record answers "is there another page" without a second
      // query and without guessing from a full page.
      const fetched = await Course.find()
        .select('title description tags modules outlineStatus createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit + 1)
        .populate({
          path: 'modules',
          select: 'title lessons',
          options: { maxTimeMS: READ_MAX_TIME_MS },
          populate: { path: 'lessons', select: 'title', options: { maxTimeMS: READ_MAX_TIME_MS } },
        })
        .maxTimeMS(READ_MAX_TIME_MS);

      const hasMore = fetched.length > limit;
      const courses = (hasMore ? fetched.slice(0, limit) : fetched).map((course) => {
        // Titles establish legacy fallback status. Keep the list's module
        // references, without serializing partial lessons as pending content.
        const plain = course.toObject({ depopulate: true });
        plain.outlineStatus = effectiveOutlineStatus(course);
        return serializeCourse(plain);
      });

      res.json({ courses, page, pageSize: limit, hasMore });
    } catch (err) {
      next(err);
    }
  }

  async function getCourse(req, res, next) {
    const startedAt = startTimer();
    try {
      const course = await populatedCourse(req.params.id).maxTimeMS(READ_MAX_TIME_MS);
      // Scoped to the populated database read alone. It is not an
      // end-to-end latency figure.
      logOperation({
        operation: 'db_populated_read',
        status: course ? 'hit' : 'miss',
        durationMs: elapsedMsSince(startedAt),
      });
      if (!course) return sendError(res, 404, 'not_found', 'Course not found');
      res.json(serializeCourse(course));
    } catch (err) {
      next(err);
    }
  }

  async function exportCoursePdf(req, res, next) {
    try {
      const course = await populatedCourse(req.params.id).maxTimeMS(READ_MAX_TIME_MS);
      if (!course) return sendError(res, 404, 'not_found', 'Course not found');
      // Settles only when the response has the last byte, or the render or
      // pipeline failed. Without the await, a stream failure would surface
      // as an unhandled rejection and the client would keep a truncated file.
      await streamCoursePdf(course, res, { createPdfDocument });
    } catch (err) {
      next(err);
    }
  }

  // Generates every not-yet-ready lesson, streaming one `module` event per
  // module once all of its lessons have been processed or skipped, then
  // exactly one terminal `done` or `error` event.
  async function generateCourseContent(req, res, next) {
    // Registered before the lookup: a client that leaves while the course is
    // being read must still be noticed.
    const context = createRequestContext(req, res, { timeoutMs: bulkTimeoutMs });
    let heartbeat = null;

    let options;
    let course;
    try {
      options = parseGenerationOptions(req.body);
      course = await readWithinRequest(populatedCourse(req.params.id).maxTimeMS(READ_MAX_TIME_MS), context);
      if (!course) {
        context.complete();
        context.dispose();
        return sendError(res, 404, 'not_found', 'Course not found');
      }
    } catch (err) {
      context.complete();
      context.dispose();
      if (context.clientDisconnected()) return;
      return next(context.deadlineExpired() ? new GenerationTimeoutError() : err);
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders?.();

    function canWrite() {
      return !res.destroyed && res.writable && !res.writableEnded;
    }

    function sendEvent(event, data) {
      if (!canWrite()) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    // Comment frames only: they keep proxies from closing an idle
    // connection and never represent progress.
    heartbeat = setInterval(() => {
      if (canWrite()) res.write(': keepalive\n\n');
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();

    try {
      for (const courseModule of course.modules) {
        throwIfSettled(context.signal, context.deadlineAt);

        for (const lesson of courseModule.lessons) {
          throwIfSettled(context.signal, context.deadlineAt);
          await lessonGenerator.generateAndPersistLesson({
            lesson,
            courseTitle: course.title,
            moduleTitle: courseModule.title,
            force: options.force,
            signal: context.signal,
            // The earlier of this lesson's own budget and what is left of
            // the request's.
            deadlineAt: Math.min(monotonicNow() + LESSON_OPERATION_TOTAL_MS, context.deadlineAt),
          });
        }

        // Emitted only once every lesson in the module has been handled.
        throwIfSettled(context.signal, context.deadlineAt);
        sendEvent('module', serializeModule(courseModule));
      }

      throwIfSettled(context.signal, context.deadlineAt);
      sendEvent('done', summarize(course));
      context.complete();
    } catch (err) {
      // A client that left receives nothing further, and its departure is
      // not an error.
      if (!context.clientDisconnected()) {
        // When this request's own budget is what ran out, that is the
        // failure -- whatever shape the interrupted call's error took.
        const failure = context.deadlineExpired() ? new GenerationTimeoutError() : err;
        logError('POST /api/courses/:id/generate-content', failure);
        const { code, message, retriable } = normalizeError(failure);
        sendEvent('error', { code, message, retriable });
      }
      context.complete();
    } finally {
      clearInterval(heartbeat);
      context.dispose();
      if (!res.writableEnded) res.end();
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

module.exports = {
  createCourseController,
  parseGenerationOptions,
  parsePagination,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  OUTLINE_REQUEST_TOTAL_MS,
  BULK_REQUEST_TOTAL_MS,
  HEARTBEAT_INTERVAL_MS,
};
