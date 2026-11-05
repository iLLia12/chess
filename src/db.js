'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'chess',
  password: process.env.DB_PASSWORD || 'chess',
  database: process.env.DB_NAME || 'chess',
  waitForConnections: true,
  connectionLimit: 10,
  multipleStatements: false,
  dateStrings: false,
  timezone: 'Z',
});

async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function one(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function exec(sql, params) {
  const [result] = await pool.query(sql, params);
  return result;
}

async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

// CREATE TABLE IF NOT EXISTS statements, so this is safe on every boot.
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const statements = sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
  for (const statement of statements) {
    await pool.query(statement);
  }
  await upgradeUsers();
}

// Databases created before accounts had emails and passwords: add the
// columns. Old rows cannot sign in, so this refuses to run while any exist
// rather than guess credentials for them.
async function upgradeUsers() {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email'`
  );
  if (cols.length) return;
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM users');
  if (n > 0) {
    throw new Error(
      `the users table has ${n} accounts from before email/password sign-in; remove them (npm run reset-db) and start again`
    );
  }
  await pool.query(
    `ALTER TABLE users
       ADD COLUMN email VARCHAR(254) NOT NULL AFTER id,
       ADD COLUMN password_hash VARCHAR(255) NOT NULL AFTER nickname,
       ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash,
       MODIFY country CHAR(2) DEFAULT NULL,
       ADD UNIQUE KEY uq_users_email (email)`
  );
}

module.exports = { pool, query, one, exec, transaction, migrate };
