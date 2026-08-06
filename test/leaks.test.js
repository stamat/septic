import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createServer } from '../lib/server.js'
import { hashPassword } from '../lib/auth.js'

// What must never leave the database through the API: columns the config does
// not declare (password_hash above all), and rows expanded past their own read
// rule. Deliberately not covered: field-level *read* access — septic has none;
// declaring a field exposes it to whoever passes the resource's access.read.
const DB = new URL('./tmp-leaks.db', import.meta.url).pathname
const DB2 = new URL('./tmp-leaks2.db', import.meta.url).pathname
const wipe = () => [DB, DB2].forEach((f) => ['', '-wal', '-shm'].forEach((s) => rmSync(f + s, { force: true })))

// users is served (public read, display_name only); notes is admin-only; posts
// refs both, publicly readable — expand must honour each target's own rule.
const config = {
  dbPath: DB,
  auth: { seed: { email: 'admin@t.dev', password: 'secret123', role: 'admin' } },
  resources: {
    users: { methods: ['GET'], access: { read: 'public', write: 'admin' }, fields: { display_name: 'string' } },
    notes: { methods: ['GET'], access: { read: 'admin', write: 'admin' }, fields: { body: 'text' } },
    posts: {
      methods: ['GET', 'POST'],
      access: { read: 'public', write: 'admin' },
      fields: { title: 'string required', author: 'ref:users', note: 'ref:notes' }
    }
  }
}

// Same shape, but users is NOT a configured resource — only the table exists.
const config2 = {
  dbPath: DB2,
  auth: { seed: { email: 'admin@t.dev', password: 'secret123', role: 'admin' } },
  resources: {
    posts: { methods: ['GET'], access: { read: 'public', write: 'admin' }, fields: { title: 'string', author: 'ref:users' } }
  }
}

let base, base2, server, server2, db, db2, admin, postId
const at = (p) => `${base}${p}`

before(async() => {
  wipe()
  const built = createServer(config)
  db = built.db
  db.prepare('UPDATE users SET display_name = ? WHERE id = 1').run('Admin')
  db.prepare('INSERT INTO notes (body) VALUES (?)').run('for staff eyes')
  await new Promise((resolve) => { server = built.app.listen(0, resolve) })
  base = `http://localhost:${server.address().port}`

  const login = await fetch(at('/api/_auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@t.dev', password: 'secret123' })
  })
  admin = login.headers.getSetCookie()[0].split(';')[0]
  const created = await fetch(at('/api/posts'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: admin },
    body: JSON.stringify({ title: 'T', author: 1, note: 1 })
  })
  postId = (await created.json()).id

  const built2 = createServer(config2)
  db2 = built2.db
  db2.prepare('INSERT INTO posts (title, author) VALUES (?, ?)').run('T2', 1)
  await new Promise((resolve) => { server2 = built2.app.listen(0, resolve) })
  base2 = `http://localhost:${server2.address().port}`
})
after(() => { server?.close(); server2?.close(); db?.close(); db2?.close(); wipe() })

test('a served users table returns only its declared fields — never password_hash, email or role', async() => {
  const rows = await (await fetch(at('/api/users'))).json()
  assert.ok(rows.length >= 1)
  assert.deepEqual(Object.keys(rows[0]).sort(), ['display_name', 'id'], 'exactly id + declared fields')
})

test('expanding a ref to users carries no password_hash', async() => {
  const row = await (await fetch(at(`/api/posts/${postId}?expand=author`))).json()
  assert.equal(typeof row.author, 'object')
  assert.equal(row.author.display_name, 'Admin')
  assert.equal(row.author.password_hash, undefined, 'an expanded user must not carry password_hash')
})

test('expand obeys the target read rule: anonymous keeps the id, admin gets the row', async() => {
  const anon = await (await fetch(at(`/api/posts/${postId}?expand=note`))).json()
  assert.equal(anon.note, 1, 'admin-only target stays an id for the public')
  const authed = await (await fetch(at(`/api/posts/${postId}?expand=note`), { headers: { cookie: admin } })).json()
  assert.equal(authed.note.body, 'for staff eyes')
})

test('a ref into a table the config does not serve is not expandable by anyone', async() => {
  const [row] = await (await fetch(`${base2}/api/posts?expand=author`)).json()
  assert.equal(row.author, 1, 'no configured resource, no expansion')
})

test('a leaked column cannot ride in on a filter echo either', async() => {
  // Filtering by an undeclared column is ignored (not an error), and the rows
  // that come back are still shaped.
  const rows = await (await fetch(at(`/api/users?password_hash=${encodeURIComponent(hashPassword('x').slice(0, 8))}`))).json()
  assert.ok(Array.isArray(rows))
  for (const r of rows) assert.equal(r.password_hash, undefined)
})
