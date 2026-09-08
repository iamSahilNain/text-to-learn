const express = require('express');
const { createCourseController } = require('../controllers/courseController');

function createCourseRouter(dependencies) {
  const router = express.Router();
  const controller = createCourseController(dependencies);
  // Each of these costs a billed model call, so they carry their own,
  // much tighter budget on top of the global one.
  const limitGeneration = dependencies.limiters?.generation ?? ((req, res, next) => next());

  router.post('/generate', limitGeneration, controller.createCourse);
  router.get('/', controller.getCourses);
  router.get('/:id', controller.getCourse);
  router.get('/:id/pdf', controller.exportCoursePdf);
  router.post('/:id/generate-content', limitGeneration, controller.generateCourseContent);

  return router;
}

module.exports = { createCourseRouter };
