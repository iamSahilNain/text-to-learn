const express = require('express');
const router = express.Router();
const {
  createCourse,
  getCourses,
  getCourse,
  exportCoursePdf,
  generateCourseContent,
} = require('../controllers/courseController');

router.post('/generate', createCourse);
router.get('/', getCourses);
router.get('/:id', getCourse);
router.get('/:id/pdf', exportCoursePdf);
router.post('/:id/generate-content', generateCourseContent);

module.exports = router;