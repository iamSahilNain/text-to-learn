const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  tags: [{ type: String, trim: true }],
  modules: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Module' }]
}, { timestamps: true });

// Backs the `GET /api/courses` list endpoint's `createdAt: -1` sort, and is
// part of the sub-100ms read-latency claim (see GET /:id, which is a plain
// indexed `_id` lookup and needs no extra index of its own).
courseSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Course', courseSchema);
