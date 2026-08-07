import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { parseResources } from './schema.js'

// One form renderer, two uses: `emitForms` writes a static partial at build
// time (empty values/errors), and the CRUD router calls `formHtml` again at
// request time with the submitted values + validation errors, so an HTMX or
// no-JS submit gets the form back showing what went wrong. That shared renderer
// is why the emitted forms actually work instead of just looking right.

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// An HTMX request always wants HTML back; otherwise honour Accept, defaulting
// to JSON (so `*/*` from fetch/curl stays JSON). Shared by every route that
// content-negotiates — crud's forms and list, auth's login page.
export const wantsHtml = (req) => req.get('HX-Request') === 'true' || req.accepts(['json', 'html']) === 'html'

const humanize = (s) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on'

// Fields the server owns are not asked for: the auto id isn't in the DSL, and a
// `datetime = now` fills itself. `include: true` forces one back in;
// `exclude: true` leaves one out — a field whose default the server applies
// (`done: boolean = false` on a create form) needs no widget. Excluding a
// required field without a default makes a form that cannot submit; that is
// the author's contradiction to notice, not septic's to resolve.
const isAsked = (f, spec) =>
  (f.default !== 'now' || spec.hints?.[f.name]?.include) && !spec.hints?.[f.name]?.exclude

function widgetFor(field, hint) {
  if (hint.widget) return hint.widget
  if (field.type === 'text' || field.type === 'json') return 'textarea'
  if (field.type === 'enum' || field.type === 'ref') return 'select'
  if (field.type === 'boolean') return 'checkbox'
  if (field.type === 'file' || field.type === 'image') return 'file'
  return 'input'
}

const inputType = (type) =>
  ({ integer: 'number', datetime: 'datetime-local', email: 'email' }[type] || 'text')

// ref: options come from the referenced table at build time (septic build has
// the DB). optionLabel names the column to show; fall back to a common one.
function options(field, hint, db, selected) {
  let list = []
  if (field.type === 'enum') {
    list = field.values.map((v) => ({ value: v, label: v }))
  } else if (field.type === 'ref' && db) {
    const rows = db.prepare(`SELECT * FROM "${field.ref}"`).all()
    const col = hint.optionLabel || ['name', 'title', 'slug'].find((c) => rows[0] && c in rows[0]) || 'id'
    list = rows.map((r) => ({ value: r.id, label: r[col] }))
  }
  return list.map((o) =>
    `<option value="${esc(o.value)}"${String(o.value) === String(selected) ? ' selected' : ''}>${esc(o.label)}</option>`
  ).join('')
}

function control(field, hint, value, id, db) {
  const name = field.name
  const req = field.required ? ' required' : ''
  const aria = hint.help ? ` aria-describedby="${id}-help"` : ''
  const val = value ?? (field.default !== undefined && field.default !== 'now' ? field.default : '')
  const widget = widgetFor(field, hint)

  if (widget === 'file') {
    const accept = field.type === 'image' ? ' accept="image/*"' : ''
    return `<input id="${id}" name="${name}" type="file"${accept}${req}${aria}>`
  }
  if (widget === 'textarea') {
    const text = typeof val === 'object' && val !== null ? JSON.stringify(val, null, 2) : val
    return `<textarea id="${id}" name="${name}"${req}${aria}>${esc(text)}</textarea>`
  }
  if (widget === 'select') return `<select id="${id}" name="${name}"${req}${aria}>${options(field, hint, db, val)}</select>`
  // The hidden 0 posts when the box is unchecked — an unchecked checkbox is
  // absent from the submit, and an edit that omits the field leaves the stored
  // value alone, so a boolean could never be turned off. When both post, the
  // validator takes the last value: the checkbox wins.
  if (widget === 'checkbox') {
    return `<input type="hidden" name="${name}" value="0"><input id="${id}" name="${name}" type="checkbox" value="1"${truthy(val) ? ' checked' : ''}${aria}>`
  }

  const pattern = field.type === 'slug' ? ' pattern="[a-z0-9][a-z0-9-]*"' : ''
  const step = field.type === 'integer' ? ' step="1"' : ''
  // Optional native-validation attrs from hints — the browser enforces these
  // client-side for free; the server still re-checks nothing it doesn't own.
  const max = hint.maxlength ? ` maxlength="${esc(hint.maxlength)}"` : ''
  const lo = hint.min != null ? ` min="${esc(hint.min)}"` : ''
  const hi = hint.max != null ? ` max="${esc(hint.max)}"` : ''
  // A datetime-local input only accepts "YYYY-MM-DDTHH:MM[:SS]"; the stored SQL
  // shape uses a space, which the browser drops silently, leaving the input blank.
  const shown = field.type === 'datetime' && typeof val === 'string' ? val.replace(' ', 'T') : val
  const value_ = shown !== '' ? ` value="${esc(shown)}"` : ''
  return `<input id="${id}" name="${name}" type="${inputType(field.type)}"${pattern}${step}${max}${lo}${hi}${value_}${req}${aria}>`
}

function fieldRow(field, spec, value, error, resourceName, db) {
  const hint = spec.hints?.[field.name] || {}
  const id = `${resourceName}-${field.name}`
  const label = hint.label || humanize(field.name)
  const help = hint.help ? `\n  <small id="${id}-help">${esc(hint.help)}</small>` : ''
  const err = error ? `\n  <small class="septic-error">${esc(error)}</small>` : ''
  return `<p class="field">\n  <label for="${id}">${esc(label)}</label>\n  ${control(field, hint, value, id, db)}${help}${err}\n</p>`
}

// Render a resource's form. values + errors prefill/annotate it (runtime
// re-render); omit both for the clean build-time create partial. Pass `id` to
// render an edit form: it targets `/api/<resource>/<id>` with PUT.
export function formHtml(resource, spec = {}, { db, values = {}, errors = {}, id = null } = {}) {
  const editing = id != null
  const base = spec.action || `/api/${resource.name}`
  const url = editing ? `${base}/${id}` : base
  const asked = resource.fields.filter((f) => isAsked(f, spec))
  const rows = asked
    .map((f) => fieldRow(f, spec, values[f.name], errors[f.name], resource.name, db))
    .join('\n')
  // File inputs need multipart; only add it when a field actually uploads.
  const enctype = asked.some((f) => f.type === 'file' || f.type === 'image') ? ' enctype="multipart/form-data"' : ''
  const formError = errors._ ? `  <p class="septic-error" role="alert">${esc(errors._)}</p>\n` : ''
  // HTML forms can't PUT natively — HTMX does the real verb via hx-put; the
  // no-JS path posts with a _method override the server honours.
  const verb = editing ? 'hx-put' : 'hx-post'
  const override = editing ? '  <input type="hidden" name="_method" value="PUT">\n' : ''
  // Same-origin + SameSite=Lax session cookie covers CSRF for the browser case;
  // a cross-origin poster needs its own token.
  return `<form class="septic-form" ${verb}="${url}" hx-swap="outerHTML" hx-target="this" method="post" action="${url}"${enctype} accept-charset="utf-8">
${override}${formError}${rows}
  <button type="submit">${esc(spec.submitLabel || (editing ? 'Update' : 'Save'))}</button>
</form>
`
}

// Build-time: write one <form> partial per configured resource.
export function emitForms(config, db) {
  const specs = config.build?.forms
  if (!specs) return {}
  const resources = Object.fromEntries(parseResources(config.resources).map((r) => [r.name, r]))
  const root = config.root || process.cwd()
  const written = {}
  for (const [name, spec] of Object.entries(specs)) {
    const resource = resources[name]
    if (!resource) throw new Error(`septic: form configured for unknown resource "${name}"`)
    const dir = path.resolve(root, spec.into)
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${name}-form.html`)
    const html = formHtml(resource, spec, { db })
    // Write only on change, so a no-op build doesn't wake watchers over the tree.
    if (!existsSync(file) || readFileSync(file, 'utf8') !== html) writeFileSync(file, html)
    written[name] = file
  }
  return written
}

// The other half of the negotiated admin: the edit form answers a writer's
// browser GET of one row, this answers the list. A table of the declared
// fields, each id a link into its edit form, the create form underneath —
// no route of its own, no build step, and an API client still gets JSON.
export function listHtml(resource, form, { db, rows, limit = 50, offset = 0 } = {}) {
  const base = `/api/${resource.name}`
  const cell = (v) => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'object') return esc(JSON.stringify(v).slice(0, 60))
    return esc(String(v).slice(0, 80))
  }
  const head = resource.fields.map((f) => `<th scope="col">${esc(humanize(f.name))}</th>`).join('')
  const body = rows.map((r) =>
    `<tr><th scope="row"><a href="${base}/${r.id}">${r.id}</a></th>${resource.fields.map((f) => `<td>${cell(r[f.name])}</td>`).join('')}</tr>`
  ).join('\n')
  // Pagination the honest way: a full page means there may be more, a first
  // page needs no way back. limit rides along so a chosen page size sticks.
  const page = (o) => `${base}?limit=${limit}&offset=${o}`
  const prev = offset > 0 ? `<a href="${page(Math.max(0, offset - limit))}">← newer</a>` : ''
  const next = rows.length === limit ? `<a href="${page(offset + limit)}">older →</a>` : ''
  const nav = prev || next ? `\n<nav class="septic-admin-pages">${prev} ${next}</nav>` : ''
  return `<section class="septic-admin">
<h1>${esc(humanize(resource.name))}</h1>
<table>
<thead><tr><th scope="col">id</th>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table>${nav}
<h2>New</h2>
${formHtml(resource, form, { db })}</section>
`
}
