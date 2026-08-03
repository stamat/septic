import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

// One SQLite file, WAL for concurrent reads, FKs enforced. Same knobs as
// pooppress/server/db.js — the proven config.
export function openDb(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}

// SQLite-friendly timestamp ("YYYY-MM-DD HH:MM:SS"), used for `datetime = now`.
export const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ')
