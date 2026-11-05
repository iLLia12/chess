'use strict';

const express = require('express');
const db = require('../db');
const sse = require('../sse');
const { requireAdmin } = require('../auth');
const { USER_COLUMNS, ValidationError, createUser, adminView } = require('../users');

const router = express.Router();
router.use(requireAdmin);

router.get('/users', async (_req, res, next) => {
  try {
    const rows = await db.query(`SELECT ${USER_COLUMNS} FROM users ORDER BY joined_at DESC, id DESC`);
    res.json({ users: rows.map((row) => ({ ...adminView(row), online: sse.isOnline(Number(row.id)) })) });
  } catch (err) {
    next(err);
  }
});

// The generated password is in this response and nowhere else.
router.post('/users', async (req, res, next) => {
  try {
    const { user, password } = await createUser(req.body || {});
    res.status(201).json({ user: { ...adminView(user), online: false }, password });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
