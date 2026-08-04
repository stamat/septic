// Field DSL — the whole point of septic: a resource's fields are strings in
// poops.json, parsed once into a descriptor that both the DB layer and the
// validator read. One source of truth.
//
//   "<type>[ flag]... [ = default]"
//   types:   string | text | slug | email | integer | boolean | datetime
//            | json | file | image | enum(a,b,c) | ref:<resource>
//   flags:   required | unique | ondelete=cascade|setnull|restrict (ref only)
//   default: "= <value>"  ("= now" fills a datetime at insert; "= now!" also
//            re-stamps it on every update — an updated_at column)

const TYPE_SQL = {
  string: 'TEXT',
  text: 'TEXT',
  slug: 'TEXT',
  email: 'TEXT',
  json: 'TEXT',
  file: 'TEXT',
  image: 'TEXT',
  enum: 'TEXT',
  integer: 'INTEGER',
  boolean: 'INTEGER',
  datetime: 'TEXT',
  ref: 'INTEGER'
}

const ON_DELETE = { cascade: 'CASCADE', setnull: 'SET NULL', restrict: 'RESTRICT' }

export function parseField(name, spec) {
  const parts = String(spec).trim().split(/\s+/)
  const head = parts.shift()
  const field = { name, required: false, unique: false, default: undefined, touch: false }

  // Default is everything after "=". A trailing "!" (e.g. "now!") marks a
  // touch field: re-applied on every write, not just insert.
  const eq = parts.indexOf('=')
  if (eq !== -1) {
    let def = parts.slice(eq + 1).join(' ')
    if (def.endsWith('!')) { field.touch = true; def = def.slice(0, -1) }
    field.default = def
    parts.splice(eq)
  }
  for (const flag of parts) {
    if (flag === 'required') field.required = true
    else if (flag === 'unique') field.unique = true
    else if (flag.startsWith('ondelete=')) field.onDelete = flag.slice(9)
    else throw new Error(`septic: unknown flag "${flag}" on field "${name}"`)
  }

  if (head.startsWith('ref:')) {
    field.type = 'ref'
    field.ref = head.slice(4)
  } else if (head.startsWith('enum(')) {
    field.type = 'enum'
    field.values = head.slice(5, head.lastIndexOf(')')).split(',').map((s) => s.trim())
  } else {
    field.type = head
  }
  if (!TYPE_SQL[field.type]) throw new Error(`septic: unknown type "${field.type}" on field "${name}"`)
  if (field.onDelete && !ON_DELETE[field.onDelete]) throw new Error(`septic: bad ondelete "${field.onDelete}" on "${name}"`)
  return field
}

export function parseResource(name, def) {
  return {
    name,
    fields: Object.entries(def.fields || {}).map(([n, s]) => parseField(n, s)),
    methods: def.methods || ['GET', 'POST', 'PUT', 'DELETE'],
    access: { read: 'public', write: 'admin', ...(def.access || {}) },
    fieldAccess: def.fieldAccess || {}, // { field: { write: role | [roles] } }
    indexes: def.indexes || [], // ["status"] or [["status","published_at"]]
    uniques: (def.unique || []).map((u) => Array.isArray(u) ? u : [u]) // composite unique
  }
}

export const parseResources = (resources) =>
  Object.entries(resources).map(([n, d]) => parseResource(n, d))

export const jsonFields = (resource) => resource.fields.filter((f) => f.type === 'json').map((f) => f.name)

function columnSql(f) {
  let sql = `"${f.name}" ${TYPE_SQL[f.type]}`
  if (f.required && f.default === undefined) sql += ' NOT NULL'
  if (f.unique) sql += ' UNIQUE'
  return sql
}

export function createTable(db, resource) {
  const cols = ['"id" INTEGER PRIMARY KEY AUTOINCREMENT']
  const fks = []
  for (const f of resource.fields) {
    cols.push(columnSql(f))
    if (f.type === 'ref') {
      let fk = `FOREIGN KEY ("${f.name}") REFERENCES "${f.ref}"("id")`
      if (f.onDelete) fk += ` ON DELETE ${ON_DELETE[f.onDelete]}`
      fks.push(fk)
    }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS "${resource.name}" (${[...cols, ...fks].join(', ')})`)

  for (const u of resource.uniques) {
    const cs = u.map((c) => `"${c}"`).join(', ')
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "ux_${resource.name}_${u.join('_')}" ON "${resource.name}" (${cs})`)
  }
  for (const ix of resource.indexes) {
    const arr = Array.isArray(ix) ? ix : [ix]
    const cs = arr.map((c) => `"${c}"`).join(', ')
    db.exec(`CREATE INDEX IF NOT EXISTS "ix_${resource.name}_${arr.join('_')}" ON "${resource.name}" (${cs})`)
  }
}

// Add any field columns missing from an existing table. This lets a config
// resource extend a pre-created table (e.g. the auth `users` table) and gives a
// poor-man's forward migration for added fields. Added columns are nullable —
// SQLite's ALTER ADD COLUMN can't carry UNIQUE, and NOT NULL needs a default.
export function ensureColumns(db, resource) {
  const existing = new Set(db.prepare(`PRAGMA table_info("${resource.name}")`).all().map((c) => c.name))
  for (const f of resource.fields) {
    if (!existing.has(f.name)) db.exec(`ALTER TABLE "${resource.name}" ADD COLUMN "${f.name}" ${TYPE_SQL[f.type]}`)
  }
}

// ponytail: create-if-not-exists + additive ALTER for dev. A destructive change
// (drop/retype a column) still needs a real migration — see docs/DOGFOOD.md.
export function createTables(db, resources) {
  for (const r of resources) { createTable(db, r); ensureColumns(db, r) }
}
