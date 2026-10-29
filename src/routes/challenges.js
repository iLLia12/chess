'use strict';

const express = require('express');
const { GameError } = require('../games');
const challenges = require('../challenges');
const { requireUser } = require('../auth');

const router = express.Router();
router.use(requireUser);

function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof GameError) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
}

router.get('/', handle(async (req, res) => {
  res.json({ challenges: await challenges.listChallenges(req.user.id) });
}));

router.post('/', handle(async (req, res) => {
  const challenge = await challenges.createChallenge(req.user.id, Number(req.body && req.body.userId));
  res.status(201).json({ challenge });
}));

router.post('/:id/accept', handle(async (req, res) => {
  res.json({ gameId: await challenges.acceptChallenge(Number(req.params.id), req.user.id) });
}));

// Decline (challenged player) or cancel (challenger).
router.delete('/:id', handle(async (req, res) => {
  await challenges.removeChallenge(Number(req.params.id), req.user.id);
  res.json({ ok: true });
}));

module.exports = router;
