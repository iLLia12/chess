'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { loadUser } = require('./auth');

const app = express();
app.set('etag', false);

app.use(express.json());
app.use(cookieParser());
app.use(loadUser);

app.use('/api', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/games', require('./routes/games'));
app.use('/api/challenges', require('./routes/challenges'));
app.use('/api/events', require('./routes/events'));

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// Single-page app: anything that is not an API call falls back to the shell.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

module.exports = app;
