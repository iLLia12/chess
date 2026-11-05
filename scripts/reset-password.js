'use strict';

// Generates a new password for an account, prints it once and signs that
// account out everywhere. For when the shown-once password was lost.
// Run with:  npm run reset-password -- someone@example.com

require('dotenv').config();

const db = require('../src/db');
const { resetPassword } = require('../src/users');

(async () => {
  const email = process.argv[2];
  if (!email) {
    console.log('Usage:  npm run reset-password -- someone@example.com');
    process.exit(1);
  }
  const password = await resetPassword(email);
  if (!password) {
    console.error(`No account with email ${email}`);
    process.exitCode = 1;
  } else {
    console.log(`New password for ${email}: ${password}\nIt is shown only once. Save it now.`);
  }
  await db.pool.end();
})().catch(async (err) => {
  console.error(err.message);
  try { await db.pool.end(); } catch (_) {}
  process.exit(1);
});
