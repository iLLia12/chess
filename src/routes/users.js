'use strict';

const express = require('express');
const db = require('../db');
const sse = require('../sse');
const { publicUser } = require('../games');
const { requireUser } = require('../auth');

const router = express.Router();
router.use(requireUser);

// Everyone except me - online players first. Used by the "new game" panel.
router.get('/', async (req, res) => {
  const rows = await db.query(
    'SELECT id, nickname, avatar, country, joined_at, last_seen_at FROM users WHERE id <> ? ORDER BY last_seen_at DESC LIMIT 100',
    [req.user.id]
  );
  const users = rows.map((row) => publicUser(row)).sort((a, b) => Number(b.online) - Number(a.online));
  res.json({ users });
});

// Autocomplete for the friends popup: nicknames starting with the query come
// first, then ones containing it anywhere. Each hit says if it is a friend.
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 32);
  if (!q) return res.json({ users: [] });
  const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 20);
  const like = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const rows = await db.query(
    `SELECT u.id, u.nickname, u.avatar, u.country, u.joined_at, u.last_seen_at,
            (f.friend_id IS NOT NULL) AS is_friend
       FROM users u
       LEFT JOIN friendships f ON f.user_id = ? AND f.friend_id = u.id
      WHERE u.id <> ? AND u.nickname LIKE ?
      ORDER BY (u.nickname LIKE ?) DESC, CHAR_LENGTH(u.nickname), u.nickname
      LIMIT ?`,
    [req.user.id, req.user.id, `%${like}%`, `${like}%`, limit]
  );
  res.json({ users: rows.map((row) => ({ ...publicUser(row), isFriend: Boolean(Number(row.is_friend)) })) });
});

router.get('/friends', async (req, res) => {
  const rows = await db.query(
    `SELECT u.id, u.nickname, u.avatar, u.country, u.joined_at, u.last_seen_at
       FROM friendships f JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = ?
      ORDER BY u.nickname`,
    [req.user.id]
  );
  res.json({ friends: rows.map((row) => publicUser(row)) });
});

router.post('/friends/:id', async (req, res) => {
  const friendId = Number(req.params.id);
  if (!friendId || friendId === req.user.id) return res.status(400).json({ error: 'Bad friend id' });
  const friend = await db.one('SELECT id FROM users WHERE id = ?', [friendId]);
  if (!friend) return res.status(404).json({ error: 'No such user' });
  // Friendship is mutual here, so insert both directions.
  await db.exec('INSERT IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?), (?, ?)', [
    req.user.id, friendId, friendId, req.user.id,
  ]);
  sse.sendTo([req.user.id, friendId], 'friends', { reason: 'added' });
  res.json({ ok: true });
});

router.delete('/friends/:id', async (req, res) => {
  const friendId = Number(req.params.id);
  await db.exec('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', [
    req.user.id, friendId, friendId, req.user.id,
  ]);
  sse.sendTo([req.user.id, friendId], 'friends', { reason: 'removed' });
  res.json({ ok: true });
});

module.exports = router;
