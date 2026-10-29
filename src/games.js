'use strict';

const { Chess } = require('chess.js');
const db = require('./db');
const sse = require('./sse');

function publicUser(row, prefix) {
  if (!row) return null;
  const get = (k) => (prefix ? row[`${prefix}_${k}`] : row[k]);
  const id = Number(get('id'));
  return {
    id,
    nickname: get('nickname'),
    avatar: get('avatar'),
    country: get('country'),
    joinedAt: get('joined_at'),
    lastSeenAt: get('last_seen_at'),
    online: sse.isOnline(id),
  };
}

const GAME_SELECT = `
  SELECT g.*,
         w.id AS w_id, w.nickname AS w_nickname, w.avatar AS w_avatar, w.country AS w_country,
         w.joined_at AS w_joined_at, w.last_seen_at AS w_last_seen_at,
         b.id AS b_id, b.nickname AS b_nickname, b.avatar AS b_avatar, b.country AS b_country,
         b.joined_at AS b_joined_at, b.last_seen_at AS b_last_seen_at
    FROM games g
    JOIN users w ON w.id = g.white_id
    JOIN users b ON b.id = g.black_id
`;

async function getGameRow(id) {
  return db.one(`${GAME_SELECT} WHERE g.id = ?`, [id]);
}

async function getMoves(gameId) {
  return db.query(
    'SELECT ply, color, san, from_sq, to_sq, promotion, captured, fen_after, created_at FROM moves WHERE game_id = ? ORDER BY ply',
    [gameId]
  );
}

// Replays the stored moves so chess.js knows the whole history (needed for
// threefold repetition) and is the single source of truth for legality.
function replay(moves) {
  const chess = new Chess();
  for (const m of moves) {
    chess.move({ from: m.from_sq, to: m.to_sq, promotion: m.promotion || undefined });
  }
  return chess;
}

function legalMovesBySquare(chess) {
  const out = {};
  for (const move of chess.moves({ verbose: true })) {
    (out[move.from] = out[move.from] || []).push(move.to);
  }
  for (const from of Object.keys(out)) out[from] = [...new Set(out[from])];
  return out;
}

function capturedPieces(moves) {
  // A move by white captures a black piece, and vice versa.
  const byWhite = [];
  const byBlack = [];
  for (const m of moves) {
    if (!m.captured) continue;
    (m.color === 'w' ? byWhite : byBlack).push(m.captured);
  }
  return { byWhite, byBlack };
}

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function materialScore(pieces) {
  return pieces.reduce((sum, p) => sum + (PIECE_VALUE[p] || 0), 0);
}

function serializeGame(row, moves, viewerId) {
  const chess = replay(moves);
  const white = publicUser(row, 'w');
  const black = publicUser(row, 'b');
  const live = row.status === 'active';
  const yourColor = viewerId === white.id ? 'w' : viewerId === black.id ? 'b' : null;
  const turn = chess.turn();
  const captured = capturedPieces(moves);
  const last = moves.length ? moves[moves.length - 1] : null;

  return {
    id: Number(row.id),
    status: row.status,
    result: row.result,
    resultReason: row.result_reason,
    fen: chess.fen(),
    turn,
    ply: moves.length,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    drawOfferBy: row.draw_offer_by ? Number(row.draw_offer_by) : null,
    inCheck: chess.inCheck(),
    white,
    black,
    yourColor,
    yourTurn: live && yourColor !== null && yourColor === turn,
    moves: moves.map((m) => ({
      ply: m.ply,
      color: m.color,
      san: m.san,
      from: m.from_sq,
      to: m.to_sq,
      promotion: m.promotion,
      captured: m.captured,
      fen: m.fen_after,
    })),
    lastMove: last ? { from: last.from_sq, to: last.to_sq } : null,
    captured: {
      byWhite: captured.byWhite,
      byBlack: captured.byBlack,
      advantage: materialScore(captured.byWhite) - materialScore(captured.byBlack),
    },
    legalMoves: live && yourColor === turn ? legalMovesBySquare(chess) : {},
  };
}

async function getGame(id, viewerId) {
  const row = await getGameRow(id);
  if (!row) return null;
  const moves = await getMoves(id);
  return serializeGame(row, moves, viewerId);
}

function participants(row) {
  return [Number(row.white_id), Number(row.black_id)];
}

// Pushes the new state of a game to both players, and nudges their game lists.
async function publishGame(id) {
  const row = await getGameRow(id);
  if (!row) return;
  const moves = await getMoves(id);
  for (const uid of participants(row)) {
    sse.sendTo(uid, 'game', serializeGame(row, moves, uid));
    sse.sendTo(uid, 'games', { reason: 'game-updated', gameId: Number(row.id) });
  }
}

async function createGame(userA, userB) {
  const whiteFirst = Math.random() < 0.5;
  const whiteId = whiteFirst ? userA : userB;
  const blackId = whiteFirst ? userB : userA;
  const result = await db.exec(
    'INSERT INTO games (white_id, black_id, fen, ply) VALUES (?, ?, ?, 0)',
    [whiteId, blackId, new Chess().fen()]
  );
  const id = result.insertId;
  await publishGame(id);
  return id;
}

async function finish(conn, gameId, result, reason) {
  await conn.query(
    'UPDATE games SET status = ?, result = ?, result_reason = ?, draw_offer_by = NULL, finished_at = NOW() WHERE id = ?',
    ['finished', result, reason, gameId]
  );
}

function outcomeOf(chess) {
  if (chess.isCheckmate()) return { result: chess.turn() === 'w' ? 'black' : 'white', reason: 'checkmate' };
  if (chess.isStalemate()) return { result: 'draw', reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { result: 'draw', reason: 'insufficient-material' };
  if (chess.isThreefoldRepetition()) return { result: 'draw', reason: 'threefold-repetition' };
  if (chess.isDraw()) return { result: 'draw', reason: 'fifty-move-rule' };
  return null;
}

class GameError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

async function makeMove(gameId, userId, { from, to, promotion }) {
  await db.transaction(async (conn) => {
    const [[row]] = await conn.query('SELECT * FROM games WHERE id = ? FOR UPDATE', [gameId]);
    if (!row) throw new GameError('Game not found', 404);
    if (row.status !== 'active') throw new GameError('Game is already finished', 409);

    const white = Number(row.white_id);
    const black = Number(row.black_id);
    if (userId !== white && userId !== black) throw new GameError('Not your game', 403);

    const [moveRows] = await conn.query(
      'SELECT ply, color, san, from_sq, to_sq, promotion, captured, fen_after FROM moves WHERE game_id = ? ORDER BY ply',
      [gameId]
    );
    const chess = replay(moveRows);
    const color = userId === white ? 'w' : 'b';
    if (chess.turn() !== color) throw new GameError('Not your turn', 409);

    let move;
    try {
      move = chess.move({ from, to, promotion: promotion || undefined });
    } catch (_) {
      move = null;
    }
    if (!move) throw new GameError('Illegal move', 422);

    const ply = moveRows.length + 1;
    await conn.query(
      `INSERT INTO moves (game_id, ply, color, san, from_sq, to_sq, promotion, captured, fen_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [gameId, ply, color, move.san, move.from, move.to, move.promotion || null, move.captured || null, chess.fen()]
    );

    // A move always withdraws any pending draw offer.
    await conn.query('UPDATE games SET fen = ?, ply = ?, draw_offer_by = NULL WHERE id = ?', [chess.fen(), ply, gameId]);

    const outcome = outcomeOf(chess);
    if (outcome) await finish(conn, gameId, outcome.result, outcome.reason);
  });

  await publishGame(gameId);
}

async function resign(gameId, userId) {
  await db.transaction(async (conn) => {
    const [[row]] = await conn.query('SELECT * FROM games WHERE id = ? FOR UPDATE', [gameId]);
    if (!row) throw new GameError('Game not found', 404);
    if (row.status !== 'active') throw new GameError('Game is already finished', 409);
    const white = Number(row.white_id);
    const black = Number(row.black_id);
    if (userId !== white && userId !== black) throw new GameError('Not your game', 403);
    await finish(conn, gameId, userId === white ? 'black' : 'white', 'resignation');
  });
  await publishGame(gameId);
}

async function draw(gameId, userId, action) {
  await db.transaction(async (conn) => {
    const [[row]] = await conn.query('SELECT * FROM games WHERE id = ? FOR UPDATE', [gameId]);
    if (!row) throw new GameError('Game not found', 404);
    if (row.status !== 'active') throw new GameError('Game is already finished', 409);
    const white = Number(row.white_id);
    const black = Number(row.black_id);
    if (userId !== white && userId !== black) throw new GameError('Not your game', 403);
    const offeredBy = row.draw_offer_by ? Number(row.draw_offer_by) : null;

    if (action === 'offer') {
      if (offeredBy === userId) return;
      if (offeredBy && offeredBy !== userId) {
        await finish(conn, gameId, 'draw', 'agreement');
        return;
      }
      await conn.query('UPDATE games SET draw_offer_by = ? WHERE id = ?', [userId, gameId]);
    } else if (action === 'accept') {
      if (!offeredBy || offeredBy === userId) throw new GameError('No draw offer to accept', 409);
      await finish(conn, gameId, 'draw', 'agreement');
    } else if (action === 'decline') {
      if (!offeredBy || offeredBy === userId) throw new GameError('No draw offer to decline', 409);
      await conn.query('UPDATE games SET draw_offer_by = NULL WHERE id = ?', [gameId]);
    } else {
      throw new GameError('Unknown draw action', 400);
    }
  });
  await publishGame(gameId);
}

// Tiles on the home screen: enough to draw a mini board plus the opponent card.
function serializeTile(row, viewerId, moveCount) {
  const white = publicUser(row, 'w');
  const black = publicUser(row, 'b');
  const yourColor = viewerId === white.id ? 'w' : 'b';
  const opponent = yourColor === 'w' ? black : white;
  const fen = row.fen;
  const turn = fen.split(' ')[1];
  let outcome = null;
  if (row.status === 'finished') {
    if (row.result === 'draw') outcome = 'draw';
    else outcome = (row.result === 'white' ? 'w' : 'b') === yourColor ? 'win' : 'loss';
  }
  return {
    id: Number(row.id),
    status: row.status,
    result: row.result,
    resultReason: row.result_reason,
    outcome,
    fen,
    turn,
    ply: Number(row.ply),
    yourColor,
    yourTurn: row.status === 'active' && turn === yourColor,
    opponent,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    lastSan: moveCount ? moveCount.last_san : null,
    lastMove: moveCount ? { from: moveCount.from_sq, to: moveCount.to_sq } : null,
  };
}

async function listGames(userId, { status, limit = 10, offset = 0 } = {}) {
  const rows = await db.query(
    `${GAME_SELECT}
      WHERE (g.white_id = ? OR g.black_id = ?) AND g.status = ?
      ORDER BY ${status === 'active' ? 'g.updated_at DESC' : 'g.finished_at DESC'}
      LIMIT ? OFFSET ?`,
    [userId, userId, status, Number(limit), Number(offset)]
  );
  const ids = rows.map((r) => r.id);
  let lastMoves = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const sans = await db.query(
      `SELECT m.game_id, m.san AS last_san, m.from_sq, m.to_sq
         FROM moves m
         JOIN (SELECT game_id, MAX(ply) AS ply FROM moves WHERE game_id IN (${placeholders}) GROUP BY game_id) t
           ON t.game_id = m.game_id AND t.ply = m.ply`,
      ids
    );
    lastMoves = Object.fromEntries(sans.map((s) => [Number(s.game_id), s]));
  }
  return rows.map((row) => serializeTile(row, userId, lastMoves[Number(row.id)]));
}

async function countGames(userId, status) {
  const row = await db.one(
    'SELECT COUNT(*) AS n FROM games WHERE (white_id = ? OR black_id = ?) AND status = ?',
    [userId, userId, status]
  );
  return Number(row.n);
}

module.exports = {
  GameError,
  publicUser,
  getGame,
  getGameRow,
  getMoves,
  serializeGame,
  createGame,
  makeMove,
  resign,
  draw,
  listGames,
  countGames,
  publishGame,
};
