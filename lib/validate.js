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
    default:
      return v
  }
}

// Validate + coerce a record against a parsed resource → a plain object ready
// for SQLite. Throws ValidationError on the first problem.
// partial=true (PUT): only fields actually present are touched.
export function coerce(resource, data, { partial = false } = {}) {
  const out = {}
  for (const f of resource.fields) {
    const v = data[f.name]
    const missing = v === undefined || v === null || v === ''
    if (missing) {
      if (partial) continue
      if (f.default !== undefined) { out[f.name] = defaultValue(f); continue }
      if (f.required) throw new ValidationError(`"${f.name}" is required`, f.name)
      out[f.name] = null
      continue
    }
    out[f.name] = check(f, v)
  }
  return out
}
