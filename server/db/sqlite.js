import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { LEGACY_USER_ID } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

let db;

function defaultDbPath() {
  return path.join(DATA_DIR, "sunnyd.db");
}

function getDb(dbPath) {
  if (db) return db;
  const resolved = dbPath || defaultDbPath();
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(database) {
  const tableRows = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const names = new Set(tableRows.map(r => r.name));

  if (names.has("workspace") && !names.has("workspaces")) {
    const old = database.prepare("SELECT notes_json, active_id, updated_at FROM workspace WHERE id = 1").get();
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE workspaces (
        user_id TEXT PRIMARY KEY,
        notes_json TEXT NOT NULL,
        active_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    if (old) {
      database
        .prepare(
          "INSERT INTO workspaces (user_id, notes_json, active_id, updated_at) VALUES (?, ?, ?, ?)",
        )
        .run(LEGACY_USER_ID, old.notes_json, old.active_id, old.updated_at);
    }
    database.exec("DROP TABLE workspace");
    return;
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      user_id TEXT PRIMARY KEY,
      notes_json TEXT NOT NULL,
      active_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

export async function initDb(config) {
  getDb(config.sqlitePath || undefined);
}

export async function createUser(email, passwordHash) {
  const id = randomUUID();
  const createdAt = Date.now();
  try {
    getDb()
      .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(id, email.trim().toLowerCase(), passwordHash, createdAt);
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE")) {
      const e = new Error("Email already registered");
      e.code = "EMAIL_TAKEN";
      throw e;
    }
    throw err;
  }
  return { id, email: email.trim().toLowerCase(), createdAt };
}

export async function findUserByEmail(email) {
  return (
    getDb()
      .prepare("SELECT id, email, password_hash, created_at FROM users WHERE email = ? COLLATE NOCASE")
      .get(email.trim().toLowerCase()) || null
  );
}

export async function findUserById(id) {
  return (
    getDb()
      .prepare("SELECT id, email, created_at FROM users WHERE id = ?")
      .get(id) || null
  );
}

export async function readWorkspace(userId) {
  const row = getDb()
    .prepare("SELECT notes_json, active_id, updated_at FROM workspaces WHERE user_id = ?")
    .get(userId);
  if (!row) return null;
  let notes;
  try {
    notes = JSON.parse(row.notes_json);
  } catch {
    return null;
  }
  if (!Array.isArray(notes)) return null;
  return { notes, activeId: row.active_id, updatedAt: row.updated_at };
}

export async function writeWorkspace(userId, notes, activeId) {
  const updatedAt = Date.now();
  const notesJson = JSON.stringify(notes);
  getDb()
    .prepare(`
      INSERT INTO workspaces (user_id, notes_json, active_id, updated_at)
      VALUES (@userId, @notesJson, @activeId, @updatedAt)
      ON CONFLICT(user_id) DO UPDATE SET
        notes_json = excluded.notes_json,
        active_id = excluded.active_id,
        updated_at = excluded.updated_at
    `)
    .run({ userId, notesJson, activeId: String(activeId), updatedAt });
  return { updatedAt };
}

export async function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
