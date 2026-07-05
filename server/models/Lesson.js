const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  videoId: String,
  title: String,
  channel: String,
  thumbnail: String,
  url: String
}, { _id: false });

const lessonSchema = new mongoose.Schema({
  title: { type: String, required: true },
  objectives: { type: [String], default: [] },
  content: { type: [mongoose.Schema.Types.Mixed], required: true },
  videos: { type: [videoSchema], default: [] },
  // Distinguishes "no videos because YouTube genuinely had none" from "no
  // videos because enrichment failed/quota ran out" -- see services/youtube.js.
  enrichmentStatus: {
    type: String,
    enum: ['no_key', 'ok', 'no_results', 'unavailable'],
    default: 'no_key',
  },
  isEnriched: { type: Boolean, default: false },
  module: { type: mongoose.Schema.Types.ObjectId, ref: 'Module' }
}, { timestamps: true });

module.exports = mongoose.model('Lesson', lessonSchema);