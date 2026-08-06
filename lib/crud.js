import { Router } from 'express'
import multer from 'multer'
import { coerce, validateAll, ValidationError } from './validate.js'
import { formHtml } from './forms.js'
import { saveUpload } from './media.js'
import { allows } from './auth.js'

// Wrap an async route so a thrown/rejected error reaches express instead of
// becoming an unhandled rejection (express 4 only catches sync throws).
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Build a REST router for one parsed resource. Only the HTTP methods listed in
// resource.methods get routes (à la carte, like poops config blocks). Reads are
// gated by access.read, writes by access.write.
//
// `form` (optional) is the resource's build.forms spec. When present, the create
// and update routes content-negotiate: browsers/HTMX get HTML back (a form
// re-rendered with errors, or a redirect on success), API clients get JSON.
// Without it every route is JSON-only — unchanged.
//
// `all` maps resource name → parsed resource for every configured resource;
// expand uses it to apply the target's own read rule.
export function crudRouter(db, resource, form, media, all = {}) {
  const r = Router()
  const t = resource.name
  const has = (m) => resource.methods.includes(m)
  const byId = db.prepare(`SELECT * FROM "${t}" WHERE id = ?`)

  const guardRead = (req, res, next) => allows(req.user, resource.access.read) ? next() : deny(res)
  const guardWrite = (req, res, next) => allows(req.user, resource.access.write) ? next() : deny(res)

  // Resources with file/image fields accept multipart; multer parses it into
  // req.body (text) + req.files. mergeFiles stores each upload and puts its path
  // back on the body so the normal validate/insert path treats it as a string.
  const fileTypes = Object.fromEntries(resource.fields.filter((f) => f.type === 'file' || f.type === 'image').map((f) => [f.name, f.type]))
  const fileFields = Object.keys(fileTypes)
  const upload = fileFields.length
    ? multer({ storage: multer.memoryStorage(), limits: { fileSize: media?.maxBytes || 10 * 1024 * 1024 } })
      .fields(fileFields.map((n) => ({ name: n, maxCount: 1 })))
    : (req, _res, next) => next()
  const mergeFiles = async(req) => {
    for (const n of fileFields) {
      const f = req.files?.[n]?.[0]
      if (!f) continue
      const meta = await saveUpload(f, media)
      // image keeps the whole metadata blob (dimensions + variants); file keeps the path.
      req.body[n] = fileTypes[n] === 'image' ? JSON.stringify(meta) : meta.path
    }
  }

  // Column allow-list — every identifier that reaches SQL is checked against
  // this, so a query param can never inject one. Values are always bound.
  const cols = new Set(resource.fields.map((f) => f.name).concat('id'))

  if (has('GET')) {
    r.get('/', guardRead, (req, res) => {
      const { limit: lim, offset: off, sort, order, expand, ...filters } = req.query
      const limit = Math.min(Number(lim) || 50, 200)
      const offset = Number(off) || 0

      // Equality filters: any real column named in the query. Unknown params are
      // ignored, not errors — a stray ?utm= shouldn't 400.
      const where = []
      const params = []
      for (const [k, v] of Object.entries(filters)) {
        if (cols.has(k)) { where.push(`"${k}" = ?`); params.push(v) }
      }
      const sortCol = cols.has(sort) ? sort : 'id'
      const dir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC'
      const sql = `SELECT * FROM "${t}"${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY "${sortCol}" ${dir} LIMIT ? OFFSET ?`

      let rows = db.prepare(sql).all(...params, limit, offset).map((row) => hydrateRow(resource, row))
      if (expand) rows = rows.map((row) => expandRow(db, resource, row, expand, all, req.user))
      res.json(rows)
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
      const out = hydrateRow(resource, row)
      res.json(req.query.expand ? expandRow(db, resource, out, req.query.expand, all, req.user) : out)
    })
  }

  if (has('POST')) {
    r.post('/', upload, guardWrite, asyncH(async(req, res) => {
      await mergeFiles(req)
      const html = form && wantsHtml(req)
      const body = stripUnwritable(resource, req.body || {}, req.user)
      const { data, errors } = validateAll(resource, body)
      if (Object.keys(errors).length) return fail(res, html, { resource, form, db, body, errors, status: 422 })
      try {
        const row = insert(db, t, data)
        return html ? succeed(req, res, form, row) : res.status(201).json(hydrateRow(resource, row))
      } catch (err) {
        const c = constraint(err)
        if (!c) throw err
        return fail(res, html, { resource, form, db, body, errors: { _: c.msg }, status: c.status })
      }
    }))
  }

  if (has('PUT')) {
    r.put('/:id', upload, guardWrite, asyncH(async(req, res) => {
      await mergeFiles(req)
      const html = form && wantsHtml(req)
      const id = req.params.id
      const body = stripUnwritable(resource, req.body || {}, req.user)
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

// Shape a row for the API: the id plus the declared fields, with json/image
// TEXT columns parsed back to objects. SELECT * can drag along columns the
// config never declared — password_hash on a served users table is the
// canonical one — and those must stay in the database, not the response.
function hydrateRow(resource, row) {
  if (!row) return row
  const out = { id: row.id }
  for (const f of resource.fields) {
    if (!(f.name in row)) continue
    let v = row[f.name]
    if ((f.type === 'json' || f.type === 'image') && typeof v === 'string') {
      try { v = JSON.parse(v) } catch { /* leave raw */ }
    }
    out[f.name] = v
  }
  return out
}

// Drop fields the user isn't allowed to write (resource.fieldAccess) before
// validation — so an author submitting status=published just can't change it,
// rather than getting a 403 mid-form.
function stripUnwritable(resource, body, user) {
  const out = { ...body }
  for (const [field, rule] of Object.entries(resource.fieldAccess || {})) {
    if (rule.write && !allows(user, rule.write) && field in out) delete out[field]
  }
  return out
}

// ?expand=author,editor → replace each named ref field's id with the referenced
// row. Expansion is a read of the target, so it obeys the target's own rules:
// the target must be a configured resource, the requester must pass its
// access.read, and the row comes back shaped like any direct read of it.
// Otherwise the id stays put — a ref into a table the config does not serve
// (dogfood users, say) is not expandable by anyone.
function expandRow(db, resource, row, expand, all, user) {
  const wanted = new Set(String(expand).split(','))
  const out = { ...row }
  for (const f of resource.fields) {
    if (f.type !== 'ref' || !wanted.has(f.name) || out[f.name] == null) continue
    const target = all[f.ref]
    if (!target || !allows(user, target.access.read)) continue
    const ref = db.prepare(`SELECT * FROM "${f.ref}" WHERE id = ?`).get(out[f.name])
    if (ref) out[f.name] = hydrateRow(target, ref)
  }
  return out
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
  res.json(hydrateRow(resource, db.prepare(`SELECT * FROM "${t}" WHERE id = ?`).get(id)))
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
