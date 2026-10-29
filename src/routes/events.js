'use strict';

const express = require('express');
const db = require('../db');
const sse = require('../sse');
const { requireUser } = require('../auth');

const router = express.Router();

const HEARTBEAT_MS = 25000;

router.get('/', requireUser, async (req, res) => {
  const userId = req.user.id;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const cameOnline = sse.add(userId, res);
  await db.exec('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [userId]);

  sse.write(res, 'hello', { userId, online: sse.onlineIds() });
  if (cameOnline) sse.broadcast('presence', { userId, online: true });

  const beat = setInterval(() => {
    res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  req.on('close', async () => {
    clearInterval(beat);
    const wentOffline = sse.remove(userId, res);
    if (wentOffline) {
      sse.broadcast('presence', { userId, online: false });
      try {
        await db.exec('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [userId]);
      } catch (_) {}
    }
  });
});

module.exports = router;
