'use strict';

const db = require('./db');

// Dev-grade session: the signed-in user id lives in a cookie. There is no
// password in the spec, so logging in is "claim this nickname".
const COOKIE = 'uid';

function setSession(res, userId) {
  res.cookie(COOKIE, String(userId), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE);
}

async function loadUser(req, _res, next) {
  const raw = req.cookies && req.cookies[COOKIE];
  const id = Number(raw);
  if (id) {
    req.user = await db.one(
      'SELECT id, nickname, avatar, country, joined_at, last_seen_at FROM users WHERE id = ?',
      [id]
    );
    if (req.user) req.user.id = Number(req.user.id);
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

module.exports = { COOKIE, setSession, clearSession, loadUser, requireUser };
