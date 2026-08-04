import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseResources } from './schema.js'

// One form renderer, two uses: `emitForms` writes a static partial at build
// time (empty values/errors), and the CRUD router calls `formHtml` again at
// request time with the submitted values + validation errors, so an HTMX or
// no-JS submit gets the form back showing what went wrong. That shared renderer
// is why the emitted forms actually work instead of just looking right.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const humanize = (s) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on'

// Fields the server owns are not asked for: the auto id isn't in the DSL, and a
// `datetime = now` fills itself. `include: true` forces one back in.
const isAsked = (f, spec) => f.default !== 'now' || spec.hints?.[f.name]?.include

function widgetFor(field, hint) {
  if (hint.widget) return hint.widget
  if (field.type === 'text') return 'textarea'
  if (field.type === 'enum' || field.type === 'ref') return 'select'
  if (field.type === 'boolean') return 'checkbox'
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

  if (widget === 'textarea') return `<textarea id="${id}" name="${name}"${req}${aria}>${esc(val)}</textarea>`
  if (widget === 'select') return `<select id="${id}" name="${name}"${req}${aria}>${options(field, hint, db, val)}</select>`
  if (widget === 'checkbox') return `<input id="${id}" name="${name}" type="checkbox" value="1"${truthy(val) ? ' checked' : ''}${aria}>`

  const pattern = field.type === 'slug' ? ' pattern="[a-z0-9][a-z0-9-]*"' : ''
  const step = field.type === 'integer' ? ' step="1"' : ''
  // Optional native-validation attrs from hints — the browser enforces these
  // client-side for free; the server still re-checks nothing it doesn't own.
  const max = hint.maxlength ? ` maxlength="${esc(hint.maxlength)}"` : ''
  const lo = hint.min != null ? ` min="${esc(hint.min)}"` : ''
  const hi = hint.max != null ? ` max="${esc(hint.max)}"` : ''
  const value_ = val !== '' ? ` value="${esc(val)}"` : ''
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

// Render a resource's create form. values + errors prefill/annotate it (runtime
// re-render); omit both for the clean build-time partial.
export function formHtml(resource, spec = {}, { db, values = {}, errors = {} } = {}) {
  const action = spec.action || `/api/${resource.name}`
  const rows = resource.fields
    .filter((f) => isAsked(f, spec))
    .map((f) => fieldRow(f, spec, values[f.name], errors[f.name], resource.name, db))
    .join('\n')
  const formError = errors._ ? `  <p class="septic-error" role="alert">${esc(errors._)}</p>\n` : ''
  // hx-post drives progressive enhancement; method/action keep it submitting
  // without JS. Same-origin + SameSite=Lax session cookie covers CSRF for the
  // browser case; a cross-origin poster needs its own token.
  return `<form class="septic-form" hx-post="${action}" hx-swap="outerHTML" hx-target="this" method="post" action="${action}" accept-charset="utf-8">
${formError}${rows}
  <button type="submit">${esc(spec.submitLabel || 'Save')}</button>
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
    writeFileSync(file, formHtml(resource, spec, { db }))
    written[name] = file
  }
  return written
}
