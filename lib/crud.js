import { Router } from 'express'
import { coerce, validateAll, ValidationError } from './validate.js'
import { formHtml } from './forms.js'
import { allows } from './auth.js'

// Build a REST router for one parsed resource. Only the HTTP methods listed in
// resource.methods get routes (à la carte, like poops config blocks). Reads are
// gated by access.read, writes by access.write.
//
// `form` (optional) is the resource's build.forms spec. When present, the create
// and update routes content-negotiate: browsers/HTMX get HTML back (a form
// re-rendered with errors, or a redirect on success), API clients get JSON.
// Without it every route is JSON-only — unchanged.
export function crudRouter(db, resource, form) {
  const r = Router()
  const t = resource.name
  const has = (m) => resource.methods.includes(m)
  const byId = db.prepare(`SELECT * FROM "${t}" WHERE id = ?`)

  const guardRead = (req, res, next) => allows(req.user, resource.access.read) ? next() : deny(res)
  const guardWrite = (req, res, next) => allows(req.user, resource.access.write) ? next() : deny(res)

  if (has('GET')) {
    r.get('/', guardRead, (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 50, 200)
      const offset = Number(req.query.offset) || 0
      res.json(db.prepare(`SELECT * FROM "${t}" ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, offset))
    })
    r.get('/:id', guardRead, (req, res) => {
      const row = byId.get(req.params.id)
      if (!row) return notFound(res)
      // A browser/HTMX GET of a row, from someone allowed to write it, is a
      // request to edit — hand back the prefilled edit form. Everyone else (and
      // every API client) gets the JSON.
      if (form && has('PUT') && wantsHtml(req) && allows(req.user, resource.access.write)) {
        return res.send(formHtml(resource, form, { db, values: row, id: row.id }))
      }
      res.json(row)
    })
  }

  if (has('POST')) {
    r.post('/', guardWrite, (req, res) => {
      const html = form && wantsHtml(req)
      const body = req.body || {}
      const { data, errors } = validateAll(resource, body)
      if (Object.keys(errors).length) return fail(res, html, { resource, form, db, body, errors, status: 422 })
      try {
        const row = insert(db, t, data)
        return html ? succeed(req, res, form, row) : res.status(201).json(row)
      } catch (err) {
        const c = constraint(err)
        if (!c) throw err
        return fail(res, html, { resource, form, db, body, errors: { _: c.msg }, status: c.status })
      }
    })
  }

  if (has('PUT')) {
    r.put('/:id', guardWrite, (req, res) => {
      const html = form && wantsHtml(req)
      const id = req.params.id
      const body = req.body || {}
      if (!html) return run(res, () => putJson(db, t, resource, body, id, res)) // JSON: partial, unchanged

      const { data, errors } = validateAll(resource, body, { insert: false })
      if (Object.keys(errors).length) return fail(res, true, { resource, form, db, body, errors, status: 422, id })
      const keys = Object.keys(data)
      if (!keys.length) return fail(res, true, { resource, form, db, body, errors: { _: 'nothing to update' }, status: 400, id })
      try {
        const info = update(db, t, data, id)
        if (!info.changes) return notFound(res)
        return succeed(req, res, form, byId.get(id))
      } catch (err) {
        const c = constraint(err)
        if (!c) throw err
        return fail(res, true, { resource, form, db, body, errors: { _: c.msg }, status: c.status, id })
      }
    })
  }

  if (has('DELETE')) {
    r.delete('/:id', guardWrite, (req, res) => {
      const info = db.prepare(`DELETE FROM "${t}" WHERE id = ?`).run(req.params.id)
      info.changes ? res.status(204).end() : notFound(res)
    })
  }

  return r
}

function insert(db, t, data) {
  const keys = Object.keys(data)
  const info = db.prepare(
    `INSERT INTO "${t}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  ).run(...keys.map((k) => data[k]))
  return db.prepare(`SELECT * FROM "${t}" WHERE id = ?`).get(info.lastInsertRowid)
}

function update(db, t, data, id) {
  const keys = Object.keys(data)
  return db.prepare(`UPDATE "${t}" SET ${keys.map((k) => `"${k}" = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => data[k]), id)
}

function putJson(db, t, resource, body, id, res) {
  const data = coerce(resource, body, { partial: true })
  const keys = Object.keys(data)
  if (!keys.length) return res.status(400).json({ error: 'no fields to update' })
  const info = update(db, t, data, id)
  if (!info.changes) return notFound(res)
  res.json(db.prepare(`SELECT * FROM "${t}" WHERE id = ?`).get(id))
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
    return res.status(200).send('<p class="septic-form-success" role="status">Saved.</p>')
  }
  return res.redirect(303, to || req.get('Referer') || '.')
}

// Failure: HTML path re-renders the form (create or, with id, edit) carrying the
// values and errors; JSON path keeps its shape (first error + the full map).
function fail(res, html, { resource, form, db, body, errors, status, id = null }) {
  if (html) return res.status(status).send(formHtml(resource, form, { db, values: body, errors, id }))
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

// JSON PUT/DELETE error mapping: turn expected failures into status codes.
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
