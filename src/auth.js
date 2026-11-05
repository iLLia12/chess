'use strict';

const crypto = require('crypto');
const db = require('./db');

// Sessions: the cookie holds a random token, the database holds its SHA-256,
// so a leaked database does not hand out working cookies.
const COOKIE = 'sid';
const SESSION_DAYS = 30;

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.exec('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, NOW() + INTERVAL ? DAY)', [
    tokenHash(token), userId, SESSION_DAYS,
  ]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * SESSION_DAYS,
  });
}

async function endSession(req, res) {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) await db.exec('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);
  res.clearCookie(COOKIE);
}

async function loadUser(req, _res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE];
    if (token) {
      req.user = await db.one(
        `SELECT u.id, u.email, u.nickname, u.avatar, u.country, u.is_admin, u.joined_at, u.last_seen_at
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > NOW()`,
        [tokenHash(token)]
      );
      if (req.user) {
        req.user.id = Number(req.user.id);
        req.user.isAdmin = Boolean(Number(req.user.is_admin));
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Admins only' });
  next();
}

module.exports = { COOKIE, startSession, endSession, loadUser, requireUser, requireAdmin };
