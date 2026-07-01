import pg from "pg";
import { randomUUID } from "node:crypto";
import { LEGACY_USER_ID } from "../config.js";

const { Pool } = pg;

let pool;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notes_json TEXT NOT NULL,
  active_id TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
`;

export async function initDb(config) {
  pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  await pool.query(SCHEMA);
}

export async function createUser(email, passwordHash) {
  const id = randomUUID();
  const createdAt = Date.now();
  const normalized = email.trim().toLowerCase();
  try {
    await pool.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)",
      [id, normalized, passwordHash, createdAt],
    );
  } catch (err) {
    if (err.code === "23505") {
      const e = new Error("Email already registered");
      e.code = "EMAIL_TAKEN";
      throw e;
    }
    throw err;
  }
  return { id, email: normalized, createdAt };
}

export async function findUserByEmail(email) {
  const { rows } = await pool.query(
    "SELECT id, email, password_hash, created_at FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
    [email.trim()],
  );
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await pool.query(
    "SELECT id, email, created_at FROM users WHERE id = $1 LIMIT 1",
    [id],
  );
  return rows[0] || null;
}

export async function readWorkspace(userId) {
  if (userId === LEGACY_USER_ID) return null;
  const { rows } = await pool.query(
    "SELECT notes_json, active_id, updated_at FROM workspaces WHERE user_id = $1 LIMIT 1",
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  let notes;
  try {
    notes = JSON.parse(row.notes_json);
  } catch {
    return null;
  }
  if (!Array.isArray(notes)) return null;
  return { notes, activeId: row.active_id, updatedAt: Number(row.updated_at) };
}

export async function writeWorkspace(userId, notes, activeId) {
  const updatedAt = Date.now();
  const notesJson = JSON.stringify(notes);
  await pool.query(
    `INSERT INTO workspaces (user_id, notes_json, active_id, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       notes_json = EXCLUDED.notes_json,
       active_id = EXCLUDED.active_id,
       updated_at = EXCLUDED.updated_at`,
    [userId, notesJson, String(activeId), updatedAt],
  );
  return { updatedAt };
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
