// The programmatic data layer — what a host application composes septic through
// when it has its own routes and does not want an HTTP round trip to reach its
// own database. `crudRouter` is a thin HTTP skin over exactly these calls, so
// there is one implementation of "what a read returns" and one of "who may
// write this field", not two that drift.
//
// Every method enforces the same rules the API does: `access.read`/`access.write`
// per call, `fieldAccess` per field, reads shaped to the declared fields, and
// `expand` obeying the referenced resource's own read rule. The caller passes
// `user`; omitting it reads as anonymous, which `allows` denies for anything not
// declared "public" — so a forgotten argument fails closed.
//
// Failures throw rather than return a status: ValidationError (422, carrying an
// `errors` map), AccessError (401/403), NotFoundError (404), ConflictError
// (409/422). Each carries `.status`, which is what lets the router map them
// without knowing their names.
import { coerce, validateAll, ValidationError } from './validate.js'
import { allows } from './auth.js'

export class AccessError extends Error {
  constructor(user) {
    super(user ? 'forbidden' : 'unauthorized')
    this.name = 'AccessError'
    // Anonymous gets 401 ("who are you"), a known user gets 403 ("not you") —
    // telling them apart is what lets a client know whether logging in helps.
    this.status = user ? 403 : 401
  }
}

export class NotFoundError extends Error {
  constructor() {
    super('not found')
    this.name = 'NotFoundError'
    this.status = 404
  }
}

export class ConflictError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ConflictError'
    this.status = status
  }
}

// SQLite reports both of these as constraint failures with no field attached;
// the API contract has always been 409 for a duplicate and 422 for a dangling
// reference, so the mapping lives here rather than at each call site.
export function constraintError(err) {
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return new ConflictError('duplicate value', 409)
  if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return new ConflictError('referenced record not found', 422)
  return null
}

// Shape a row for a caller: the id plus the declared fields, with json/image
// TEXT columns parsed back to objects. `SELECT *` drags along columns the config
// never declared — password_hash on a served users table is the canonical one —
// and those stay in the database.
export function hydrateRow(resource, row) {
  if (!row) return row
  const out = { id: row.id }
  for (const f of resource.fields) {
    if (!(f.name in row)) continue
    let v = row[f.name]
    if ((f.type === 'json' || f.type === 'image') && typeof v === 'string') {
      try { v = JSON.parse(v) } catch { /* leave raw */ }
    }
    // SQLite stores booleans as 0/1; the declared type is what the caller
    // asked for, so it is what comes back. null stays null — an unset
    // nullable boolean is not false.
    if (f.type === 'boolean' && v !== null && v !== undefined) v = Boolean(v)
    out[f.name] = v
  }
  return out
}

// Drop fields the user isn't allowed to write before validation — so an author
// submitting status=published simply can't change it, rather than getting a 403
// mid-form and losing the rest of their edit.
export function stripUnwritable(resource, body, user) {
  const out = { ...body }
  for (const [field, rule] of Object.entries(resource.fieldAccess || {})) {
    if (rule.write && !allows(user, rule.write) && field in out) delete out[field]
  }
  return out
}

// Turn the field-error map validateAll returns into the single throwable the
// data layer promises, without losing the map — the HTML form path re-renders
// every field's error at once, so it reads `err.errors`.
function throwErrors(errors) {
  const first = Object.keys(errors).find((k) => k !== '_') ?? Object.keys(errors)[0]
  const err = new ValidationError(errors[first], first === '_' ? undefined : first)
  err.errors = errors
  throw err
}

// One resource's operations. `all` maps resource name → parsed resource, so
// expand can apply the target's own read rule; without it a ref stays an id.
export function resourceStore(db, resource, all = {}) {
  const t = resource.name
  // Column allow-list — every identifier that reaches SQL is checked against it,
  // so a caller-supplied filter or sort key can never inject one. Values bind.
  const cols = new Set(resource.fields.map((f) => f.name).concat('id'))
  const byId = db.prepare(`SELECT * FROM "${t}" WHERE id = ?`)

  const readable = (user) => { if (!allows(user, resource.access.read)) throw new AccessError(user) }
  const writable = (user) => { if (!allows(user, resource.access.write)) throw new AccessError(user) }

  function expand(row, fields, user) {
    const wanted = new Set(Array.isArray(fields) ? fields : String(fields).split(','))
    const out = { ...row }
    for (const f of resource.fields) {
      if (f.type !== 'ref' || !wanted.has(f.name) || out[f.name] == null) continue
      const target = all[f.ref]
      // A ref into a table the config does not serve is not expandable by
      // anyone — there is no read rule to satisfy, so the id stays put.
      if (!target || !allows(user, target.access.read)) continue
      const ref = db.prepare(`SELECT * FROM "${f.ref}" WHERE id = ?`).get(out[f.name])
      if (ref) out[f.name] = hydrateRow(target, ref)
    }
    return out
  }

  const shape = (row, opts, user) => (opts?.expand ? expand(hydrateRow(resource, row), opts.expand, user) : hydrateRow(resource, row))

  return {
    // `limit` is uncapped here on purpose: the API's 1–200 clamp guards an
    // untrusted query string, and that is the router's boundary, not this one.
    // A host app paginating its own admin list would be crippled by it.
    list({ user, limit = 50, offset = 0, sort, order, expand: exp, where = {} } = {}) {
      readable(user)
      const clauses = []
      const params = []
      for (const [k, v] of Object.entries(where)) {
        if (cols.has(k)) { clauses.push(`"${k}" = ?`); params.push(v) }
      }
      const sortCol = cols.has(sort) ? sort : 'id'
      const dir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC'
      const sql = `SELECT * FROM "${t}"${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''} ORDER BY "${sortCol}" ${dir} LIMIT ? OFFSET ?`
      const rows = db.prepare(sql).all(...params, Math.max(Number(limit) || 50, 1), Math.max(Number(offset) || 0, 0))
      return rows.map((row) => shape(row, { expand: exp }, user))
    },

    count({ user, where = {} } = {}) {
      readable(user)
      const clauses = []
      const params = []
      for (const [k, v] of Object.entries(where)) {
        if (cols.has(k)) { clauses.push(`"${k}" = ?`); params.push(v) }
      }
      return db.prepare(`SELECT COUNT(*) AS n FROM "${t}"${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''}`).get(...params).n
    },

    get(id, { user, expand: exp } = {}) {
      readable(user)
      const row = byId.get(id)
      if (!row) throw new NotFoundError()
      return shape(row, { expand: exp }, user)
    },

    // The unshaped row, for a caller that owns the table and needs a column the
    // config does not declare — pooppress reading password_hash to check a
    // login. It costs the read shaping, so it is a separate, named call rather
    // than a flag on `get` that someone passes without meaning to.
    raw(id, { user } = {}) {
      readable(user)
      const row = byId.get(id)
      if (!row) throw new NotFoundError()
      return row
    },

    create(data, { user } = {}) {
      writable(user)
      const body = stripUnwritable(resource, data || {}, user)
      const { data: values, errors } = validateAll(resource, body)
      if (Object.keys(errors).length) throwErrors(errors)
      const keys = Object.keys(values)
      try {
        // An all-optional resource with nothing sent: "INSERT () VALUES ()" is a
        // SQLite syntax error, but an empty create is still a valid create.
        const info = keys.length
          ? db.prepare(`INSERT INTO "${t}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
            .run(...keys.map((k) => values[k]))
          : db.prepare(`INSERT INTO "${t}" DEFAULT VALUES`).run()
        return hydrateRow(resource, byId.get(info.lastInsertRowid))
      } catch (err) {
        throw constraintError(err) || err
      }
    },

    // partial=true leaves omitted fields alone (the JSON PATCH-ish PUT);
    // partial=false applies no defaults but still errors on a cleared required
    // field, which is what an edit form needs.
    update(id, data, { user, partial = false } = {}) {
      writable(user)
      const body = stripUnwritable(resource, data || {}, user)
      const values = partial
        ? coerce(resource, body, { partial: true })
        : (() => {
            const { data: v, errors } = validateAll(resource, body, { insert: false })
            if (Object.keys(errors).length) throwErrors(errors)
            return v
          })()
      const keys = Object.keys(values)
      if (!keys.length) {
        // Not 422: nothing was wrong with the values, there were none. Both HTTP
        // paths answered 400 here before this layer existed, with two different
        // wordings; this is the one.
        const err = new ValidationError('nothing to update')
        err.status = 400
        throw err
      }
      try {
        const info = db.prepare(`UPDATE "${t}" SET ${keys.map((k) => `"${k}" = ?`).join(', ')} WHERE id = ?`)
          .run(...keys.map((k) => values[k]), id)
        if (!info.changes) throw new NotFoundError()
        return hydrateRow(resource, byId.get(id))
      } catch (err) {
        throw constraintError(err) || err
      }
    },

    remove(id, { user } = {}) {
      writable(user)
      const info = db.prepare(`DELETE FROM "${t}" WHERE id = ?`).run(id)
      if (!info.changes) throw new NotFoundError()
      return true
    }
  }
}

// Every resource's operations, keyed by name — `store.posts.list({ user })`.
// Built from the same parsed resources the server mounts, so the two cannot
// describe different schemas.
export function createStore(db, resources) {
  const all = Object.fromEntries(resources.map((r) => [r.name, r]))
  return Object.fromEntries(resources.map((r) => [r.name, resourceStore(db, r, all)]))
}
