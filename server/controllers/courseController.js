const mongoose = require('mongoose');
const Course = require('../models/Course');
const Module = require('../models/Module');
const Lesson = require('../models/Lesson');
const { generateCourseSafe } = require('../services/gemini');
const { sendError } = require('../utils/errors');

const MAX_TOPIC_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

async function createCourse(req, res, next) {
  const start = process.hrtime.bigint();
  try {
    const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
    if (!topic) {
      return sendError(res, 400, 'invalid_topic', 'Topic is required');
    }
    if (topic.length > MAX_TOPIC_LENGTH) {
      return sendError(res, 400, 'invalid_topic', `Topic must be ${MAX_TOPIC_LENGTH} characters or fewer`);
    }

    // Call Gemini first (network call, not a DB write) -- Mongo transactions
    // below should stay short-lived. generateCourseSafe (Checkpoint 1) never
    // throws a raw parser error: it validates, repairs once, and falls back
    // to a minimal labelled course rather than blowing up the request.
    const generated = await generateCourseSafe(topic);

    // All the writes below (Course + N Modules + N*M Lessons) happen in one
    // transaction so a mid-loop failure can't leave orphaned documents
    // (previously: R4 in STATUS.md).
    const session = await mongoose.startSession();
    let course;
    try {
      await session.withTransaction(async () => {
        [course] = await Course.create([{
          title: generated.title,
          description: generated.description,
          tags: generated.tags,
          modules: []
        }], { session });

        for (const mod of generated.modules) {
          const lessons = await Lesson.insertMany(
            mod.lessons.map(title => ({ title, content: [], module: null })),
            { session }
          );

          const [createdModule] = await Module.create([{
            title: mod.title,
            course: course._id,
            lessons: lessons.map(l => l._id)
          }], { session });

          await Lesson.updateMany(
            { _id: { $in: lessons.map(l => l._id) } },
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

    const populated = await Course.findById(course._id)
      .populate({ path: 'modules', populate: { path: 'lessons' } });

    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    // Wall-time measurement for the "<30s" resume claim -- dominated by the
    // Gemini call above. See STATUS.md for recorded figures.
    console.log(`[createCourse] "${populated.title}" (${populated.modules.length} modules) generated + persisted in ${ms.toFixed(0)}ms`);

    res.status(201).json(populated);
  } catch (err) {
    console.error(err);
    sendError(res, 502, 'generation_failed', 'Failed to generate course');
  }
}

async function getCourses(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));

    const courses = await Course.find()
      .select('title description tags modules createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json(courses);
  } catch (err) {
    next(err);
  }
}

async function getCourse(req, res, next) {
  const start = process.hrtime.bigint();
  try {
    const course = await Course.findById(req.params.id)
      .populate({ path: 'modules', populate: { path: 'lessons' } });

    // Read-latency measurement for the "sub-100ms" resume claim -- a single
    // indexed `_id` lookup on a small document. See STATUS.md for figures.
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`[getCourse] ${req.params.id} lookup in ${ms.toFixed(2)}ms`);

    if (!course) return sendError(res, 404, 'not_found', 'Course not found');
    res.json(course);
  } catch (err) {
    // Bad ObjectId format (CastError) is a 400, not a 500/404 -- handled by
    // the shared error middleware in server.js.
    next(err);
  }
}

module.exports = { createCourse, getCourses, getCourse };
