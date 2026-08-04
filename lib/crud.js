import { Router } from 'express'
import { coerce, validateAll, ValidationError } from './validate.js'
import { formHtml } from './forms.js'
import { allows } from './auth.js'

// Build a REST router for one parsed resource. Only the HTTP methods listed in
// resource.methods get routes (à la carte, like poops config blocks). Reads are
// gated by access.read, writes by access.write.
//
// `form` (optional) is the resource's build.forms spec. When present, the create
// route content-negotiates: browsers/HTMX get HTML back (the form re-rendered
// with errors, or a redirect on success), API clients get JSON. Without it the
// route is JSON-only — unchanged.
export function crudRouter(db, resource, form) {
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
    r.post('/', guardWrite, (req, res) => {
      const html = form && wantsHtml(req)
      const body = req.body || {}
      const { data, errors } = validateAll(resource, body)
      if (Object.keys(errors).length) return fail(res, html, { resource, form, db, body, errors, status: 422 })
      try {
        const keys = Object.keys(data)
        const info = db.prepare(
          `INSERT INTO "${t}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
        ).run(...keys.map((k) => data[k]))
        const row = db.prepare(`SELECT * FROM "${t}" WHERE id = ?`).get(info.lastInsertRowid)
        return html ? succeed(req, res, form, row) : res.status(201).json(row)
      } catch (err) {
        const c = constraint(err)
        if (!c) throw err
        return fail(res, html, { resource, form, db, body, errors: { _: c.msg }, status: c.status })
      }
    })
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

// An HTMX request always wants HTML back; otherwise honour Accept, defaulting to
// JSON (so `*/*` from fetch/curl stays JSON).
const wantsHtml = (req) => req.get('HX-Request') === 'true' || req.accepts(['json', 'html']) === 'html'

// Success on the HTML path: HTMX gets a redirect header or a small fragment;
// a plain browser form gets Post/Redirect/Get so a refresh doesn't re-submit.
function succeed(req, res, form, row) {
  const to = form.success
  if (req.get('HX-Request') === 'true') {
    if (to) { res.set('HX-Redirect', to); return res.status(204).end() }
    return res.status(201).send('<p class="septic-form-success" role="status">Saved.</p>')
  }
  return res.redirect(303, to || req.get('Referer') || '.')
}

// Failure: HTML path re-renders the form with the values and errors; JSON path
// keeps its shape (first error + the full map).
function fail(res, html, { resource, form, db, body, errors, status }) {
  if (html) return res.status(status).send(formHtml(resource, form, { db, values: body, errors }))
  const first = Object.keys(errors).find((k) => k !== '_')
  return res.status(status).json({ error: first ? errors[first] : errors._, field: first, errors })
}

function constraint(err) {
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return { msg: 'duplicate value', status: 409 }
  if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return { msg: 'referenced record not found', status: 422 }
  return null
}

const notFound = (res) => res.status(404).json({ error: 'not found' })
const deny = (res) => res.status(res.req.user ? 403 : 401).json({ error: res.req.user ? 'forbidden' : 'unauthorized' })

// PUT/DELETE stay JSON-only: turn expected failures into status codes.
function run(res, fn) {
  try {
    fn()
  } catch (err) {
    if (err instanceof ValidationError) return res.status(422).json({ error: err.message, field: err.field })
    const c = constraint(err)
    if (c) return res.status(c.status).json({ error: c.msg })
    throw err
  }
}
