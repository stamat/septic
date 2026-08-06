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

// SQLite-friendly timestamp ("YYYY-MM-DD HH:MM:SS", UTC) — the one shape every
// datetime is stored in; `datetime = now` and client-sent values both go
// through it, or TEXT ordering breaks ('T' sorts after ' ').
export const toSql = (d) => d.toISOString().slice(0, 19).replace('T', ' ')
export const nowSql = () => toSql(new Date())
