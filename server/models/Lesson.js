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
  isEnriched: { type: Boolean, default: false },
  module: { type: mongoose.Schema.Types.ObjectId, ref: 'Module' }
}, { timestamps: true });

module.exports = mongoose.model('Lesson', lessonSchema);