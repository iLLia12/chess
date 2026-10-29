'use strict';

// Challenges: an invitation to play that the other player accepts or
// declines. Accepting creates the game (random colours, like New game).
// Both players get a `games` nudge so their current-games lists refresh.

const db = require('./db');
const sse = require('./sse');
const { GameError, publicUser, createGame } = require('./games');

const CHALLENGE_SELECT = `
  SELECT c.id, c.from_id, c.to_id, c.created_at,
         u.id AS u_id, u.nickname AS u_nickname, u.avatar AS u_avatar, u.country AS u_country,
         u.joined_at AS u_joined_at, u.last_seen_at AS u_last_seen_at
    FROM challenges c
`;

function serialize(row, viewerId) {
  const incoming = Number(row.to_id) === viewerId;
  return {
    id: Number(row.id),
    direction: incoming ? 'in' : 'out',
    opponent: publicUser(row, 'u'),
    createdAt: row.created_at,
  };
}

// Pending challenges for a user, newest first, seen from that user's side.
async function listChallenges(userId) {
  const rows = await db.query(
    `${CHALLENGE_SELECT}
       JOIN users u ON u.id = IF(c.from_id = ?, c.to_id, c.from_id)
      WHERE c.from_id = ? OR c.to_id = ?
      ORDER BY c.created_at DESC, c.id DESC`,
    [userId, userId, userId]
  );
  return rows.map((row) => serialize(row, userId));
}

async function activeGameBetween(a, b) {
  return db.one(
    `SELECT id FROM games
      WHERE status = 'active'
        AND ((white_id = ? AND black_id = ?) OR (white_id = ? AND black_id = ?))`,
    [a, b, b, a]
  );
}

function nudge(userIds, payload) {
  sse.sendTo(userIds, 'games', payload);
}

async function createChallenge(fromId, toId) {
  if (!toId || toId === fromId) throw new GameError('Pick another player to challenge', 400);
  const target = await db.one('SELECT id, nickname FROM users WHERE id = ?', [toId]);
  if (!target) throw new GameError('No such user', 404);
  if (await activeGameBetween(fromId, toId)) {
    throw new GameError(`You already have a game with ${target.nickname}`, 409);
  }
  const pending = await db.one(
    'SELECT from_id FROM challenges WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)',
    [fromId, toId, toId, fromId]
  );
  if (pending) {
    throw new GameError(
      Number(pending.from_id) === fromId
        ? `You already challenged ${target.nickname}`
        : `${target.nickname} already challenged you — accept it in your current games`,
      409
    );
  }
  const result = await db.exec('INSERT INTO challenges (from_id, to_id) VALUES (?, ?)', [fromId, toId]);
  const from = await db.one('SELECT nickname FROM users WHERE id = ?', [fromId]);
  nudge([fromId], { reason: 'challenge-sent' });
  nudge([toId], { reason: 'challenge-received', from: from.nickname });
  return { id: Number(result.insertId) };
}

async function getChallenge(id, userId) {
  const row = await db.one('SELECT id, from_id, to_id FROM challenges WHERE id = ?', [id]);
  if (!row) throw new GameError('This challenge is no longer open', 404);
  const fromId = Number(row.from_id);
  const toId = Number(row.to_id);
  if (userId !== fromId && userId !== toId) throw new GameError('Not your challenge', 403);
  return { fromId, toId };
}

async function acceptChallenge(id, userId) {
  const { fromId, toId } = await getChallenge(id, userId);
  if (userId !== toId) throw new GameError('Only the challenged player can accept', 403);
  const deleted = await db.exec('DELETE FROM challenges WHERE id = ?', [id]);
  if (!deleted.affectedRows) throw new GameError('This challenge is no longer open', 404);
  const existing = await activeGameBetween(fromId, toId);
  const gameId = existing ? Number(existing.id) : await createGame(fromId, toId);
  const me = await db.one('SELECT nickname FROM users WHERE id = ?', [userId]);
  nudge([fromId], { reason: 'challenge-accepted', by: me.nickname, gameId });
  return gameId;
}

// The challenged player declines, or the challenger takes it back.
async function removeChallenge(id, userId) {
  const { fromId, toId } = await getChallenge(id, userId);
  await db.exec('DELETE FROM challenges WHERE id = ?', [id]);
  const me = await db.one('SELECT nickname FROM users WHERE id = ?', [userId]);
  const declined = userId === toId;
  nudge([userId], { reason: declined ? 'challenge-declined' : 'challenge-cancelled' });
  nudge([declined ? fromId : toId], {
    reason: declined ? 'challenge-declined' : 'challenge-cancelled',
    by: me.nickname,
  });
}

module.exports = { listChallenges, createChallenge, acceptChallenge, removeChallenge };
