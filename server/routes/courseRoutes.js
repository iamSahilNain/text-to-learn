const express = require('express');
const { createCourseController } = require('../controllers/courseController');

function createCourseRouter(dependencies) {
  const router = express.Router();
  const controller = createCourseController(dependencies);

  router.post('/generate', controller.createCourse);
  router.get('/', controller.getCourses);
  router.get('/:id', controller.getCourse);
  router.get('/:id/pdf', controller.exportCoursePdf);
  router.post('/:id/generate-content', controller.generateCourseContent);

  return router;
}

module.exports = { createCourseRouter };
