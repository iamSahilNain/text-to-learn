const express = require('express');
const router = express.Router();
const Lesson = require('../models/Lesson');

router.get('/:id', async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    res.json(lesson);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch lesson' });
  }
});

module.exports = router;