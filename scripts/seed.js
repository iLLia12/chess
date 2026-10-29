'use strict';

// Creates a few players and one game in progress so the home screen has
// something to show. Safe to re-run.

require('dotenv').config();

const db = require('../src/db');
const games = require('../src/games');

const PLAYERS = [
  { nickname: 'magnus', avatar: '🦊', country: 'NO' },
  { nickname: 'hikaru', avatar: '🐙', country: 'US' },
  { nickname: 'anna', avatar: '♞', country: 'UA' },
  { nickname: 'wei', avatar: '🐺', country: 'CN' },
];

async function upsert(player) {
  const existing = await db.one('SELECT id FROM users WHERE nickname = ?', [player.nickname]);
  if (existing) return Number(existing.id);
  const res = await db.exec('INSERT INTO users (nickname, avatar, country) VALUES (?, ?, ?)', [
    player.nickname, player.avatar, player.country,
  ]);
  return res.insertId;
}

(async () => {
  await db.migrate();
  const ids = [];
  for (const player of PLAYERS) ids.push(await upsert(player));

  const active = await db.one(
    `SELECT id FROM games WHERE status = 'active' AND
       ((white_id = ? AND black_id = ?) OR (white_id = ? AND black_id = ?))`,
    [ids[0], ids[1], ids[1], ids[0]]
  );
  if (!active) {
    const gameId = await games.createGame(ids[0], ids[1]);
    const row = await games.getGameRow(gameId);
    const opening = [
      ['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'b5'], ['a7', 'a6'],
    ];
    for (let i = 0; i < opening.length; i += 1) {
      const mover = i % 2 === 0 ? Number(row.white_id) : Number(row.black_id);
      await games.makeMove(gameId, mover, { from: opening[i][0], to: opening[i][1] });
    }
    console.log(`seeded active game #${gameId} (magnus vs hikaru) with ${opening.length} moves`);
  }

  // A finished game so the recent list is not empty.
  const finished = await db.one(
    `SELECT id FROM games WHERE status = 'finished' AND
       ((white_id = ? AND black_id = ?) OR (white_id = ? AND black_id = ?))`,
    [ids[0], ids[2], ids[2], ids[0]]
  );
  if (!finished) {
    const gameId = await games.createGame(ids[0], ids[2]);
    const row = await games.getGameRow(gameId);
    const white = Number(row.white_id);
    const black = Number(row.black_id);
    // Scholar's mate.
    const mate = [
      [white, 'e2', 'e4'], [black, 'e7', 'e5'], [white, 'f1', 'c4'], [black, 'b8', 'c6'],
      [white, 'd1', 'h5'], [black, 'g8', 'f6'], [white, 'h5', 'f7'],
    ];
    for (const [mover, from, to] of mate) await games.makeMove(gameId, mover, { from, to });
    console.log(`seeded finished game #${gameId} (checkmate)`);
  }

  console.log('players:', PLAYERS.map((p) => p.nickname).join(', '));
  await db.pool.end();
})().catch(async (err) => {
  console.error(err.message);
  try { await db.pool.end(); } catch (_) {}
  process.exit(1);
});
