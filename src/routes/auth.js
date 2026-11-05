'use strict';

const express = require('express');
const db = require('../db');
const sse = require('../sse');
const { publicUser } = require('../games');
const { verifyPassword, DUMMY_HASH } = require('../passwords');
const { startSession, endSession, requireUser } = require('../auth');

const router = express.Router();

// What the signed-in player sees about themselves: the public profile plus
// their email and whether they can open the admin page.
function selfView(user) {
  return { ...publicUser(user), email: user.email, isAdmin: Boolean(Number(user.is_admin)), online: true };
}

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: selfView(req.user) });
});

router.post('/login', async (req, res, next) => {
  try {
    await login(req, res);
  } catch (err) {
    next(err);
  }
});

async function login(req, res) {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  const user = email
    ? await db.one(
        'SELECT id, email, nickname, avatar, country, is_admin, password_hash, joined_at, last_seen_at FROM users WHERE email = ?',
        [email]
      )
    : null;
  // Always run one hash check so unknown emails are not faster to reject.
  const ok = await verifyPassword(password, user ? user.password_hash : await DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'Wrong email or password' });

  user.id = Number(user.id);
  await startSession(res, user.id);
  res.json({ user: selfView(user) });
}

router.post('/logout', requireUser, async (req, res, next) => {
  try {
    await endSession(req, res);
  } catch (err) {
    return next(err);
  }
  sse.broadcast('presence', { userId: req.user.id, online: sse.isOnline(req.user.id) });
  res.json({ ok: true });
});

module.exports = router;
