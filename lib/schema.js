// Field DSL — the whole point of septic: a resource's fields are strings in
// poops.json, parsed once into a descriptor that both the DB layer and the
// validator read. One source of truth.
//
//   "<type>[ flag]... [ = default]"
//   types:   string | text | slug | integer | boolean | datetime
//            | enum(a,b,c) | ref:<resource>
//   flags:   required | unique
//   default: "= <value>"  ("datetime = now" fills at insert time)

const TYPE_SQL = {
  string: 'TEXT', text: 'TEXT', slug: 'TEXT', enum: 'TEXT',
  integer: 'INTEGER', boolean: 'INTEGER', datetime: 'TEXT', ref: 'INTEGER'
}

export function parseField(name, spec) {
  const parts = String(spec).trim().split(/\s+/)
  const head = parts.shift()
  const field = { name, required: false, unique: false, default: undefined }

  // Default is everything after "=".
  const eq = parts.indexOf('=')
  if (eq !== -1) {
    field.default = parts.slice(eq + 1).join(' ')
    parts.splice(eq)
  }
  for (const flag of parts) {
    if (flag === 'required') field.required = true
    else if (flag === 'unique') field.unique = true
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
  return field
}

export function parseResource(name, def) {
  return {
    name,
    fields: Object.entries(def.fields || {}).map(([n, s]) => parseField(n, s)),
    methods: def.methods || ['GET', 'POST', 'PUT', 'DELETE'],
    access: { read: 'public', write: 'admin', ...(def.access || {}) }
  }
}

export const parseResources = (resources) =>
  Object.entries(resources).map(([n, d]) => parseResource(n, d))

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
    if (f.type === 'ref') fks.push(`FOREIGN KEY ("${f.name}") REFERENCES "${f.ref}"("id")`)
  }
  db.exec(`CREATE TABLE IF NOT EXISTS "${resource.name}" (${[...cols, ...fks].join(', ')})`)
}

// ponytail: declarative create-if-not-exists for dev. Numbered migrations
// (schema diff → ALTER) land before v1.0 — see SEPTIC-PLAN.md. Until then,
// changing a field on an existing table won't apply.
export function createTables(db, resources) {
  for (const r of resources) createTable(db, r)
}
