const mongoose = require('mongoose');
const { OUTLINE_STATUSES } = require('../services/generationStatus');

const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  tags: [{ type: String, trim: true }],
  // Quality of the generated outline only: ready (validated model output) or
  // degraded (the labelled fallback outline). It says nothing about whether
  // the lessons have bodies -- that is each lesson's generationStatus. No
  // schema default, for the same legacy-data reason as Lesson.
  outlineStatus: { type: String, enum: OUTLINE_STATUSES },
  modules: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Module' }]
}, { timestamps: true });

// Matches the GET /api/courses sort key exactly: createdAt descending with
// _id descending as the tiebreaker, so pagination stays stable when several
// courses share a timestamp.
courseSchema.index({ createdAt: -1, _id: -1 });

module.exports = mongoose.model('Course', courseSchema);
