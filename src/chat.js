'use strict';

// Per-game chat between the two players. Messages are stored in
// chat_messages and pushed live to both players as a `chat` SSE event.

const db = require('./db');
const sse = require('./sse');
const { GameError, getGameRow } = require('./games');

const MAX_LENGTH = 500;

function serializeMessage(row) {
  return {
    id: Number(row.id),
    gameId: Number(row.game_id),
    userId: Number(row.user_id),
    body: row.body,
    createdAt: row.created_at,
  };
}

async function playersOf(gameId, userId) {
  const row = await getGameRow(gameId);
  if (!row) throw new GameError('Game not found', 404);
  const players = [Number(row.white_id), Number(row.black_id)];
  if (!players.includes(userId)) throw new GameError('Not your game', 403);
  return players;
}

async function listMessages(gameId, userId) {
  await playersOf(gameId, userId);
  const rows = await db.query(
    'SELECT id, game_id, user_id, body, created_at FROM chat_messages WHERE game_id = ? ORDER BY id',
    [gameId]
  );
  return rows.map(serializeMessage);
}

async function postMessage(gameId, userId, text) {
  const players = await playersOf(gameId, userId);
  const body = String(text || '').trim();
  if (!body) throw new GameError('Message is empty', 400);
  if (body.length > MAX_LENGTH) throw new GameError(`Message is longer than ${MAX_LENGTH} characters`, 400);
  const result = await db.exec('INSERT INTO chat_messages (game_id, user_id, body) VALUES (?, ?, ?)', [
    gameId,
    userId,
    body,
  ]);
  const row = await db.one('SELECT id, game_id, user_id, body, created_at FROM chat_messages WHERE id = ?', [
    result.insertId,
  ]);
  const message = serializeMessage(row);
  sse.sendTo(players, 'chat', message);
  return message;
}

module.exports = { listMessages, postMessage, MAX_LENGTH };
