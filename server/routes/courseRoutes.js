const express = require('express');
const router = express.Router();
const { createCourse, getCourses } = require('../controllers/courseController');

router.post('/generate', createCourse);
router.get('/', getCourses);

module.exports = router;