const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const courseRoutes = require('./routes/courseRoutes');
const lessonRoutes = require('./routes/lessonRoutes');
const { errorMiddleware } = require('./utils/errors');

const app = express();

// CORS is open (`origin: true`, i.e. reflect the request's Origin) by
// default for local dev. Set CLIENT_ORIGIN in .env to lock it down to your
// deployed client's origin.
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => {
    // Fail loudly: a bad MONGO_URI previously left the server "up" while
    // every request 500'd forever with no signal as to why.
    console.error('MongoDB connection failed:', err.message);
    console.error('Check MONGO_URI in server/.env. The server will keep running but every DB-backed request will fail.');
  });

app.use('/api/courses', courseRoutes);
app.use('/api/lessons', lessonRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Text-to-Learn backend is running' });
});

// Shared error envelope { error: { code, message } } for anything routes
// pass to next(err). Must be mounted last.
app.use(errorMiddleware);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
