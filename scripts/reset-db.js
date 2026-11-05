'use strict';

// Removes every account along with all games, moves, chat, challenges,
// friendships and sessions (games reference players, so they cannot stay).
// The default admin is created again, with a new password, on the next boot.
// Run with:  npm run reset-db -- --yes

require('dotenv').config();

const db = require('../src/db');

const TABLES = ['chat_messages', 'moves', 'challenges', 'games', 'friendships', 'sessions', 'users'];

(async () => {
  if (!process.argv.includes('--yes')) {
    console.log('This deletes all players and games. Run again with --yes to confirm:  npm run reset-db -- --yes');
    process.exit(1);
  }
  await db.pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of TABLES) {
    const [exists] = await db.pool.query('SHOW TABLES LIKE ?', [table]);
    if (exists.length) await db.pool.query(`DELETE FROM \`${table}\``);
  }
  await db.pool.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log('All players and games removed. Restart the server to create the admin account.');
  await db.pool.end();
})().catch(async (err) => {
  console.error(err.message);
  try { await db.pool.end(); } catch (_) {}
  process.exit(1);
});
