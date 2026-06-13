const express = require('express');
const router = express.Router();
const Lesson = require('../models/Lesson');
const Module = require('../models/Module');
const Course = require('../models/Course');
const { generateLesson } = require('../services/gemini');
const { searchVideos } = require('../services/youtube');

router.get('/:id', async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    res.json(lesson);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch lesson' });
  }
});

router.post('/:id/generate', async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const module = await Module.findById(lesson.module);
    const course = await Course.findById(module.course);

    const generated = await generateLesson(course.title, module.title, lesson.title);

    lesson.objectives = generated.objectives || [];
    lesson.content = generated.content;

    // Enrich with YouTube videos. searchVideos() degrades to [] on any
    // failure or when no API key is set, so this never blocks generation.
    lesson.videos = await searchVideos(`${course.title} ${lesson.title} tutorial`);

    lesson.isEnriched = true;
    await lesson.save();

    res.json(lesson);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate lesson content' });
  }
});

module.exports = router;