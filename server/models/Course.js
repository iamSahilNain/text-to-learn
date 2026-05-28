const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  tags: [{ type: String, trim: true }],
  modules: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Module' }]
}, { timestamps: true });

module.exports = mongoose.model('Course', courseSchema);
