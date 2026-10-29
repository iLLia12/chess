'use strict';

const express = require('express');
const db = require('../db');
const sse = require('../sse');
const { publicUser } = require('../games');
const { setSession, clearSession, requireUser } = require('../auth');

const router = express.Router();

const AVATARS = ['♞', '♜', '♝', '♛', '♚', '♟', '🦊', '🐙', '🐺', '🦉'];
const COUNTRIES = ['UA', 'PL', 'DE', 'US', 'BR', 'IN', 'JP', 'NO', 'ES', 'GB'];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: { ...publicUser(req.user), online: true } });
});

// Sign in by nickname, creating the account on first use.
router.post('/login', async (req, res) => {
  const nickname = String((req.body && req.body.nickname) || '').trim();
  if (!/^[\w .-]{2,32}$/.test(nickname)) {
    return res.status(400).json({ error: 'Nickname must be 2-32 letters, digits, dot, dash or space' });
  }

  let user = await db.one('SELECT id, nickname, avatar, country, joined_at, last_seen_at FROM users WHERE nickname = ?', [nickname]);
  if (!user) {
    const country = String((req.body && req.body.country) || pick(COUNTRIES)).toUpperCase().slice(0, 2);
    const avatar = String((req.body && req.body.avatar) || pick(AVATARS)).slice(0, 16);
    const result = await db.exec('INSERT INTO users (nickname, avatar, country) VALUES (?, ?, ?)', [nickname, avatar, country]);
    user = await db.one('SELECT id, nickname, avatar, country, joined_at, last_seen_at FROM users WHERE id = ?', [result.insertId]);
  }

  user.id = Number(user.id);
  setSession(res, user.id);
  res.json({ user: { ...publicUser(user), online: true } });
});

router.post('/logout', requireUser, (req, res) => {
  clearSession(res);
  sse.broadcast('presence', { userId: req.user.id, online: sse.isOnline(req.user.id) });
  res.json({ ok: true });
});

module.exports = router;
