'use strict';

const express = require('express');
const db = require('../db');
const games = require('../games');
const chat = require('../chat');
const { requireUser } = require('../auth');

const router = express.Router();
router.use(requireUser);

function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof games.GameError) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
}

// Active games -> the tile list on the home screen.
router.get('/active', handle(async (req, res) => {
  const list = await games.listGames(req.user.id, { status: 'active', limit: 50, offset: 0 });
  res.json({ games: list });
}));

// Finished games -> the "recent games" list with its Show more button.
router.get('/recent', handle(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 25);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const [list, total] = await Promise.all([
    games.listGames(req.user.id, { status: 'finished', limit, offset }),
    games.countGames(req.user.id, 'finished'),
  ]);
  res.json({ games: list, total, hasMore: offset + list.length < total });
}));

router.post('/', handle(async (req, res) => {
  const opponentId = Number(req.body && req.body.opponentId);
  if (!opponentId || opponentId === req.user.id) throw new games.GameError('Pick an opponent', 400);
  const opponent = await db.one('SELECT id FROM users WHERE id = ?', [opponentId]);
  if (!opponent) throw new games.GameError('No such user', 404);
  const existing = await db.one(
    `SELECT id FROM games
      WHERE status = 'active'
        AND ((white_id = ? AND black_id = ?) OR (white_id = ? AND black_id = ?))`,
    [req.user.id, opponentId, opponentId, req.user.id]
  );
  if (existing) return res.status(200).json({ gameId: Number(existing.id), existing: true });
  const gameId = await games.createGame(req.user.id, opponentId);
  res.status(201).json({ gameId });
}));

router.get('/:id', handle(async (req, res) => {
  const game = await games.getGame(Number(req.params.id), req.user.id);
  if (!game) throw new games.GameError('Game not found', 404);
  if (game.yourColor === null) throw new games.GameError('Not your game', 403);
  res.json({ game });
}));

router.post('/:id/move', handle(async (req, res) => {
  const { from, to, promotion } = req.body || {};
  if (!from || !to) throw new games.GameError('from and to are required', 400);
  await games.makeMove(Number(req.params.id), req.user.id, { from, to, promotion });
  res.json({ game: await games.getGame(Number(req.params.id), req.user.id) });
}));

router.post('/:id/resign', handle(async (req, res) => {
  await games.resign(Number(req.params.id), req.user.id);
  res.json({ game: await games.getGame(Number(req.params.id), req.user.id) });
}));

router.post('/:id/draw', handle(async (req, res) => {
  const action = String((req.body && req.body.action) || 'offer');
  await games.draw(Number(req.params.id), req.user.id, action);
  res.json({ game: await games.getGame(Number(req.params.id), req.user.id) });
}));

router.get('/:id/chat', handle(async (req, res) => {
  res.json({ messages: await chat.listMessages(Number(req.params.id), req.user.id) });
}));

router.post('/:id/chat', handle(async (req, res) => {
  const message = await chat.postMessage(Number(req.params.id), req.user.id, req.body && req.body.body);
  res.status(201).json({ message });
}));

module.exports = router;
