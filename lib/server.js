import express from 'express'
import { openDb } from './db.js'
import { parseResources, createTables } from './schema.js'
import { session, ensureUsers, seedAdmin, authRouter } from './auth.js'
import { crudRouter } from './crud.js'

// Open the DB and bring the schema up: users table first (resource FKs may
// reference it), then resource tables, then the dev admin seed. Shared by the
// server and the build bridge so schema setup can't drift between them.
export function prepareDb(config) {
  const db = openDb(config.dbPath)
  ensureUsers(db)
  const resources = parseResources(config.resources)
  createTables(db, resources)
  seedAdmin(db, config.auth?.seed)
  return { db, resources }
}

// Build the express app from a loaded config. Returns { app, db } and does NOT
// listen — the caller binds the port. Keeps it testable (listen on port 0).
export function createServer(config) {
  const { db, resources } = prepareDb(config)

  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.use(session())
  app.use('/api/_auth', authRouter(db))
  for (const r of resources) app.use(`/api/${r.name}`, crudRouter(db, r))
  app.get('/api/_health', (_req, res) => res.json({ ok: true, resources: resources.map((r) => r.name) }))
  return { app, db }
}
