import { Router } from 'express'
import { coerce, ValidationError } from './validate.js'
import { allows } from './auth.js'

// Build a REST router for one parsed resource. Only the HTTP methods listed in
// resource.methods get routes (à la carte, like poops config blocks). Reads are
// gated by access.read, writes by access.write.
export function crudRouter(db, resource) {
  const r = Router()
  const t = resource.name
  const has = (m) => resource.methods.includes(m)

  const guardRead = (req, res, next) => allows(req.user, resource.access.read) ? next() : deny(res)
  const guardWrite = (req, res, next) => allows(req.user, resource.access.write) ? next() : deny(res)

  if (has('GET')) {
    r.get('/', guardRead, (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 50, 200)
      const offset = Number(req.query.offset) || 0
      res.json(db.prepare(`SELECT * FROM "${t}" ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, offset))
    })
    r.get('/:id', guardRead, (req, res) => {
      const row = db.prepare(`SELECT * FROM "${t}" WHERE id = ?`).get(req.params.id)
      row ? res.json(row) : notFound(res)
    })
  }

  if (has('POST')) {
    r.post('/', guardWrite, (req, res) => run(res, () => {
      const data = coerce(resource, req.body || {})
      const keys = Object.keys(data)
      const info = db.prepare(
        `INSERT INTO "${t}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
      ).run(...keys.map((k) => data[k]))
      res.status(201).json(db.prepare(`SELECT * FROM "${t}" WHERE id = ?`).get(info.lastInsertRowid))
    }))
  }

  if (has('PUT')) {
    r.put('/:id', guardWrite, (req, res) => run(res, () => {
      const data = coerce(resource, req.body || {}, { partial: true })
      const keys = Object.keys(data)
      if (!keys.length) return res.status(400).json({ error: 'no fields to update' })
      const info = db.prepare(`UPDATE "${t}" SET ${keys.map((k) => `"${k}" = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => data[k]), req.params.id)
      if (!info.changes) return notFound(res)
      res.json(db.prepare(`SELECT * FROM "${t}" WHERE id = ?`).get(req.params.id))
    }))
  }

  if (has('DELETE')) {
    r.delete('/:id', guardWrite, (req, res) => {
      const info = db.prepare(`DELETE FROM "${t}" WHERE id = ?`).run(req.params.id)
      info.changes ? res.status(204).end() : notFound(res)
    })
  }

  return r
}

const notFound = (res) => res.status(404).json({ error: 'not found' })
const deny = (res) => res.status(res.req.user ? 403 : 401).json({ error: res.req.user ? 'forbidden' : 'unauthorized' })

// Turn expected failures into HTTP status codes; rethrow the unexpected.
function run(res, fn) {
  try {
    fn()
  } catch (err) {
    if (err instanceof ValidationError) return res.status(422).json({ error: err.message, field: err.field })
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'duplicate value' })
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(422).json({ error: 'referenced record not found' })
    throw err
  }
}
