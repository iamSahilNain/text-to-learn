const express = require('express');
const router = express.Router();
const { createCourse, getCourses, getCourse, exportCoursePdf } = require('../controllers/courseController');

router.post('/generate', createCourse);
router.get('/', getCourses);
router.get('/:id', getCourse);
router.get('/:id/pdf', exportCoursePdf);

module.exports = router;