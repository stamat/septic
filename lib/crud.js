import { Router } from 'express'
import multer from 'multer'
import { ValidationError } from './validate.js'
import { formHtml } from './forms.js'
import { saveUpload } from './media.js'
import { allows } from './auth.js'
import { resourceStore } from './data.js'

// Wrap an async route so a thrown/rejected error reaches express instead of
// becoming an unhandled rejection (express 4 only catches sync throws).
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Build a REST router for one parsed resource. Only the HTTP methods listed in
// resource.methods get routes (à la carte, like poops config blocks). Reads are
// gated by access.read, writes by access.write.
//
// Everything below the request is `lib/data.js`: this file parses HTTP, decides
// JSON or HTML, and maps thrown errors to status codes. Access rules, field
// shaping and validation live in the store, so the API and a host application
// calling septic directly cannot enforce different things.
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
  const store = resourceStore(db, resource, all)

  // The store denies too, and is the authority. These stay because a router
  // that answers 401 before multer buffers a megabyte of upload is doing the
  // caller a favour, and because the HTML paths need the verdict as a value.
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

  if (has('GET')) {
    r.get('/', guardRead, (req, res) => {
      const { limit, offset, sort, order, expand, ...where } = req.query
      res.json(store.list({
        user: req.user,
        // Clamped here rather than in the store: this is where an untrusted
        // query string arrives. SQLite reads a negative LIMIT as "no limit", so
        // ?limit=-1 would dump the whole table past the 200 cap.
        limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
        offset,
        sort,
        order,
        expand,
        where
      }))
    })
    r.get('/:id', guardRead, (req, res) => {
      // A browser/HTMX GET of a row, from someone allowed to write it, is a
      // request to edit — hand back the prefilled edit form. Everyone else (and
      // every API client) gets the JSON.
      if (form && has('PUT') && wantsHtml(req) && allows(req.user, resource.access.write)) {
        const row = db.prepare(`SELECT * FROM "${t}" WHERE id = ?`).get(req.params.id)
        if (!row) return notFound(res)
        return res.send(formHtml(resource, form, { db, values: row, id: row.id }))
      }
      run(res, () => res.json(store.get(req.params.id, { user: req.user, expand: req.query.expand })))
    })
  }

  if (has('POST')) {
    r.post('/', upload, guardWrite, asyncH(async(req, res) => {
      await mergeFiles(req)
      const html = form && wantsHtml(req)
      try {
        const row = store.create(req.body || {}, { user: req.user })
        return html ? succeed(req, res, form, row) : res.status(201).json(row)
      } catch (err) {
        return respond(res, err, html, { resource, form, db, body: req.body || {} })
      }
    }))
  }

  if (has('PUT')) {
    // PATCH mounts with PUT rather than as its own methods entry: same guard,
    // same store call, and a resource that can take a full update can take a
    // partial one. The difference is only the contract — PATCH is partial by
    // definition; PUT's JSON body is partial for compatibility, while an HTML
    // form post is the whole row.
    const update = (alwaysPartial) => asyncH(async(req, res) => {
      await mergeFiles(req)
      const html = form && wantsHtml(req)
      const id = req.params.id
      try {
        const row = store.update(id, req.body || {}, { user: req.user, partial: alwaysPartial || !html })
        return html ? succeed(req, res, form, row) : res.json(row)
      } catch (err) {
        return respond(res, err, html, { resource, form, db, body: req.body || {}, id })
      }
    })
    r.put('/:id', upload, guardWrite, update(false))
    r.patch('/:id', upload, guardWrite, update(true))
  }

  if (has('DELETE')) {
    r.delete('/:id', guardWrite, (req, res) => {
      run(res, () => { store.remove(req.params.id, { user: req.user }); res.status(204).end() })
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
    return res.status(200).send('<p class="septic-form-success" role="status">Saved.</p>')
  }
  return res.redirect(303, to || req.get('Referer') || '.')
}

// Map a store error onto the response. The HTML path re-renders the form (create
// or, with id, edit) carrying the values and every field's error at once, which
// is why ValidationError keeps its `errors` map rather than only the first.
function respond(res, err, html, { resource, form, db, body, id = null }) {
  if (!err.status) throw err
  if (err.status === 404) return notFound(res)
  const errors = err.errors || { [err.field || '_']: err.message }
  if (html) return res.status(err.status).send(formHtml(resource, form, { db, values: body, errors, id }))
  const first = Object.keys(errors).find((k) => k !== '_')
  return res.status(err.status).json(
    err instanceof ValidationError
      ? { error: first ? errors[first] : errors._, field: first, errors }
      : { error: err.message }
  )
}

const notFound = (res) => res.status(404).json({ error: 'not found' })
const deny = (res) => res.status(res.req.user ? 403 : 401).json({ error: res.req.user ? 'forbidden' : 'unauthorized' })

// JSON-only paths: turn a thrown store error into its status code.
function run(res, fn) {
  try {
    fn()
  } catch (err) {
    if (!err.status) throw err
    if (err.status === 404) return notFound(res)
    if (err instanceof ValidationError) return res.status(err.status).json({ error: err.message, field: err.field })
    return res.status(err.status).json({ error: err.message })
  }
}
