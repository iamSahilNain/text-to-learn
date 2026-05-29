const express = require('express');
const router = express.Router();
const { createCourse, getCourses, getCourse } = require('../controllers/courseController');

router.post('/generate', createCourse);
router.get('/', getCourses);
router.get('/:id', getCourse);

module.exports = router;