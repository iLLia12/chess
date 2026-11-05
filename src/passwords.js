'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 64;

// Passwords are never chosen by people here: they are generated once and
// shown once. 12 random bytes is 96 bits, written as 16 URL-safe characters.
function generatePassword() {
  return crypto.randomBytes(12).toString('base64url');
}

// Stored as "scrypt$<salt hex>$<hash hex>".
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Compared against when the email is unknown, so a wrong email takes as long
// as a wrong password and the response time does not reveal which accounts exist.
const DUMMY_HASH = hashPassword(generatePassword());

module.exports = { generatePassword, hashPassword, verifyPassword, DUMMY_HASH };
