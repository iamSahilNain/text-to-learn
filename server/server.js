const mongoose = require('mongoose');
require('dotenv').config();

const { createApp } = require('./app');

const app = createApp();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    console.error('Check MONGO_URI in server/.env. The server will keep running but every DB-backed request will fail.');
  });

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
