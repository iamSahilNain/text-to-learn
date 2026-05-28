const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const courseRoutes = require('./routes/courseRoutes');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.log('MongoDB error:', err));

app.use('/api/courses', courseRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Text-to-Learn backend is running' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});