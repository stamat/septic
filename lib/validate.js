import { nowSql } from './db.js'

// Validation happens server-side because these values become table rows and,
// later, file paths in the poops build. The boundary is here, not the client.
export class ValidationError extends Error {
  constructor(message, field) {
    super(message)
    this.name = 'ValidationError'
    this.field = field
    this.status = 422
  }
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/
// Deliberately loose — the browser's type="email" uses a similar shape, and the
// only real proof an address works is sending to it. Reject the obviously wrong.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true'

function defaultValue(f) {
  if (f.type === 'datetime' && f.default === 'now') return nowSql()
  if (f.type === 'boolean') return truthy(f.default) ? 1 : 0
  if (f.type === 'integer' || f.type === 'ref') return Number(f.default)
  return f.default
}

function check(f, v) {
  switch (f.type) {
    case 'string': case 'text': case 'enum':
      if (typeof v !== 'string') throw new ValidationError(`"${f.name}" must be text`, f.name)
      if (f.type === 'enum' && !f.values.includes(v)) {
        throw new ValidationError(`"${f.name}" must be one of: ${f.values.join(', ')}`, f.name)
      }
      return v
    case 'slug':
      if (typeof v !== 'string' || !SLUG_RE.test(v)) {
        throw new ValidationError(`"${f.name}" must be a slug (a-z, 0-9, dashes)`, f.name)
      }
      return v
    case 'email':
      if (typeof v !== 'string' || !EMAIL_RE.test(v)) {
        throw new ValidationError(`"${f.name}" must be an email address`, f.name)
      }
      return v
    case 'integer': case 'ref': {
      const n = Number(v)
      if (!Number.isInteger(n)) throw new ValidationError(`"${f.name}" must be an integer`, f.name)
      return n
    }
    case 'boolean':
      return truthy(v) ? 1 : 0
    case 'datetime':
      if (Number.isNaN(Date.parse(v))) throw new ValidationError(`"${f.name}" must be a date`, f.name)
      return v
    case 'json':
      if (typeof v === 'string') {
        try { JSON.parse(v); return v } catch { throw new ValidationError(`"${f.name}" must be valid JSON`, f.name) }
      }
      try { return JSON.stringify(v) } catch { throw new ValidationError(`"${f.name}" must be JSON-serializable`, f.name) }
    default:
      return v
  }
}

// Validate + coerce a record against a parsed resource, collecting *every*
// field error — forms show them all at once; the JSON path takes the first.
// Returns { data, errors }: data is ready for SQLite, errors maps field → msg.
//
// partial=true (JSON PUT): only fields actually present are touched.
// insert=false (form edit): apply no defaults — a `datetime = now` must not be
// reset on every edit, and an omitted optional field is left as it was. Cleared
// required fields still error.
export function validateAll(resource, data, { partial = false, insert = true } = {}) {
  const out = {}
  const errors = {}
  for (const f of resource.fields) {
    // Touch fields (e.g. updated_at = now!) are server-owned: re-stamped on
    // every write, insert or update, whatever the client sent.
    if (f.touch) { out[f.name] = nowSql(); continue }
    const v = data[f.name]
    const missing = v === undefined || v === null || v === ''
    if (missing) {
      if (partial) continue
      if (insert && f.default !== undefined) { out[f.name] = defaultValue(f); continue }
      if (f.required) { errors[f.name] = `"${f.name}" is required`; continue }
      if (insert) out[f.name] = null
      continue
    }
    try {
      out[f.name] = check(f, v)
    } catch (err) {
      errors[f.name] = err.message
    }
  }
  return { data: out, errors }
}

// The JSON path: same validation, but throw on the first problem.
export function coerce(resource, data, opts = {}) {
  const { data: out, errors } = validateAll(resource, data, opts)
  const first = Object.keys(errors)[0]
  if (first) throw new ValidationError(errors[first], first)
  return out
}
