import express from 'express'
import { openDb } from './db.js'
import { notifier } from './notify.js'
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
  // HTML forms can only GET/POST; a _method override lets a no-JS edit form
  // reach PUT/DELETE. HTMX sends the real verb and skips this. Read it from the
  // query too, not only the body: a form with a file/image field posts
  // multipart, which the body parsers above don't touch (multer parses it later,
  // inside the router), so the hidden body field would be invisible here.
  app.use((req, _res, next) => {
    const override = req.body?._method ?? req.query?._method
    if (req.method === 'POST' && typeof override === 'string') {
      const m = override.toUpperCase()
      if (m === 'PUT' || m === 'DELETE') req.method = m
    }
    next()
  })
  app.use(session())
  app.use('/api/_auth', authRouter(db, { secure: config.auth?.secureCookies ?? process.env.NODE_ENV === 'production' }))
  const forms = config.build?.forms || {}
  const media = config.media || null
  // Serve uploaded files so an <img src> from a stored path resolves. nosniff
  // keeps a browser from promoting an upload to something executable — the
  // extension allow-list in media.js decides the Content-Type, nothing else.
  if (media?.dir) {
    app.use(media.url || '/uploads', express.static(media.dir, {
      setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff')
    }))
  }
  const byName = Object.fromEntries(resources.map((r) => [r.name, r]))
  const notify = notifier(config)
  for (const r of resources) app.use(`/api/${r.name}`, crudRouter(db, r, forms[r.name], media, byName, notify))
  app.get('/api/_health', (_req, res) => res.json({ ok: true, resources: resources.map((r) => r.name) }))
  // Last-resort error mapper. Operational errors thrown outside a route's own
  // try — multer refusing an oversized or unexpected file, or any store error
  // that escapes — would otherwise hit express's default 500 HTML page. A known
  // `.status` (ValidationError, AccessError…) is kept; a multer limit maps to
  // 413/400; anything else stays a 500 with no message leaked.
  app.use((err, _req, res, next) => {
    if (res.headersSent) return next(err)
    let status = err.status
    if (err.name === 'MulterError') status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    res.status(status || 500).json({ error: status ? err.message : 'internal error' })
  })
  return { app, db }
}
