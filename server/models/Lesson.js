const mongoose = require('mongoose');
const {
  LESSON_STATUSES,
  ENRICHMENT_STATUSES,
} = require('../services/generationStatus');

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
  // Whether a usable lesson body has been persisted: pending (none yet),
  // ready (validated model output) or degraded (the labelled fallback).
  // Deliberately has no schema default -- a default would make legacy
  // documents that predate the field indistinguishable from genuinely
  // ungenerated ones. services/generationStatus.js derives the effective
  // value for those; every new write sets it explicitly.
  generationStatus: { type: String, enum: LESSON_STATUSES },
  // Outcome of the optional YouTube lookup, independent of generation:
  // pending (no decision yet), no_key, ok, no_results, unavailable, or
  // unknown for historical rows enriched before the outcome was recorded.
  enrichmentStatus: { type: String, enum: ENRICHMENT_STATUSES },
  // True once an enrichment decision completed for the persisted lesson.
  // It is not a claim that videos were found.
  isEnriched: { type: Boolean, default: false },
  module: { type: mongoose.Schema.Types.ObjectId, ref: 'Module' }
}, { timestamps: true });

module.exports = mongoose.model('Lesson', lessonSchema);
