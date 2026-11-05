'use strict';

const db = require('./db');
const { generatePassword, hashPassword } = require('./passwords');

const AVATARS = ['♞', '♜', '♝', '♛', '♚', '♟', '🦊', '🐙', '🐺', '🦉'];
const DEFAULT_ADMIN_EMAIL = 'goncharovphp@gmail.com';

const USER_COLUMNS = 'id, email, nickname, avatar, country, is_admin, joined_at, last_seen_at';

class ValidationError extends Error {}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Checks and normalises the fields of a new account. Throws ValidationError
// with a message fit to show to the person filling in the form.
function validate({ email, nickname, country }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new ValidationError('Enter a valid email address');
  }
  const cleanNickname = String(nickname || '').trim();
  if (!/^[\w .-]{2,32}$/.test(cleanNickname)) {
    throw new ValidationError('Nickname must be 2-32 letters, digits, dot, dash or space');
  }
  const cleanCountry = String(country || '').trim().toUpperCase();
  if (cleanCountry && !/^[A-Z]{2}$/.test(cleanCountry)) {
    throw new ValidationError('Country must be a two-letter code such as UA, or left empty');
  }
  return { email: cleanEmail, nickname: cleanNickname, country: cleanCountry || null };
}

// Creates an account with a freshly generated password. The plain password is
// returned to the caller this one time; only its hash is stored.
async function createUser(fields, { isAdmin = false } = {}) {
  const { email, nickname, country } = validate(fields);
  const taken = await db.one('SELECT email, nickname FROM users WHERE email = ? OR nickname = ? LIMIT 1', [email, nickname]);
  if (taken) {
    throw new ValidationError(taken.email === email ? 'That email already has an account' : 'That nickname is taken');
  }
  const password = generatePassword();
  const passwordHash = await hashPassword(password);
  let result;
  try {
    result = await db.exec(
      'INSERT INTO users (email, nickname, password_hash, avatar, country, is_admin) VALUES (?, ?, ?, ?, ?, ?)',
      [email, nickname, passwordHash, pick(AVATARS), country, isAdmin ? 1 : 0]
    );
  } catch (err) {
    // Lost a race with another insert of the same email or nickname.
    if (err.code === 'ER_DUP_ENTRY') throw new ValidationError('That email or nickname is already taken');
    throw err;
  }
  const user = await db.one(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [result.insertId]);
  return { user, password };
}

// Gives the account a new generated password and signs it out everywhere.
async function resetPassword(email) {
  const user = await db.one('SELECT id FROM users WHERE email = ?', [String(email).trim().toLowerCase()]);
  if (!user) return null;
  const password = generatePassword();
  await db.exec('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), user.id]);
  await db.exec('DELETE FROM sessions WHERE user_id = ?', [user.id]);
  return password;
}

// Called on boot: the first time, creates the default admin and prints its
// password. The password is not stored anywhere in plain text, so this is the
// only time it can be seen (npm run reset-password issues a new one).
async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).toLowerCase();
  if (await db.one('SELECT id FROM users WHERE email = ?', [email])) return;
  const { password } = await createUser({ email, nickname: 'admin' }, { isAdmin: true });
  const line = '='.repeat(60);
  console.log(`\n${line}\n  Admin account created\n  email:    ${email}\n  password: ${password}\n  This password is shown only once. Save it now.\n${line}\n`);
}

function adminView(row) {
  return {
    id: Number(row.id),
    email: row.email,
    nickname: row.nickname,
    avatar: row.avatar,
    country: row.country,
    isAdmin: Boolean(Number(row.is_admin)),
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at,
  };
}

module.exports = { USER_COLUMNS, ValidationError, createUser, resetPassword, ensureAdmin, adminView };
