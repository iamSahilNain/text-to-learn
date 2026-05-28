const Course = require('../models/Course');
const Module = require('../models/Module');
const Lesson = require('../models/Lesson');
const { generateCourse } = require('../services/gemini');

async function createCourse(req, res) {
  try {
    const { topic } = req.body;

    if (!topic) {
      return res.status(400).json({ error: 'Topic is required' });
    }

    // Call Gemini to generate course structure
    const generated = await generateCourse(topic);

    // Save course to MongoDB
    const course = await Course.create({
      title: generated.title,
      description: generated.description,
      tags: generated.tags,
      modules: []
    });

    // Save each module and its lessons
    for (const mod of generated.modules) {
      const lessons = await Lesson.insertMany(
        mod.lessons.map(title => ({
          title,
          content: [],
          module: null
        }))
      );

      const module = await Module.create({
        title: mod.title,
        course: course._id,
        lessons: lessons.map(l => l._id)
      });

      // Update lesson references
      await Lesson.updateMany(
        { _id: { $in: lessons.map(l => l._id) } },
        { module: module._id }
      );

      course.modules.push(module._id);
    }

    await course.save();

    // Return populated course
    const populated = await Course.findById(course._id)
      .populate({
        path: 'modules',
        populate: { path: 'lessons' }
      });

    res.status(201).json(populated);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate course' });
  }
}

async function getCourses(req, res) {
  try {
    const courses = await Course.find().populate('modules');
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
}

module.exports = { createCourse, getCourses };