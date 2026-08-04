import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, readFileSync } from 'node:fs'
import { openDb } from '../lib/db.js'
import { createServer } from '../lib/server.js'
import { hashPassword } from '../lib/auth.js'

// The real dogfood: stand up pooppress's ACTUAL schema (its committed
// migration, verbatim) and have septic operate it — no septic-created tables,
// no adapted DDL. septic serves pooppress's real `posts`/`collections`/`users`
// and must honour their real constraints (the COALESCE slug index, the
// NOT NULL DEFAULT columns, the role CHECK).
const DB = new URL('./tmp-live.db', import.meta.url).pathname
const SQL = readFileSync(new URL('./fixtures/pooppress-init.sql', import.meta.url), 'utf8')
const wipe = () => ['', '-wal', '-shm'].forEach((s) => rmSync(DB + s, { force: true }))

// septic config mirroring pooppress's real column names. No unique/index here —
// pooppress's own migration already created them (incl. the COALESCE index).
const config = {
  dbPath: DB,
  auth: {},
  resources: {
    collections: {
      access: { read: 'public', write: 'admin' },
      fields: { name: 'string required', slug: 'slug required' }
    },
    posts: {
      access: { read: 'public', write: ['author', 'editor', 'admin'] },
      fieldAccess: { status: { write: ['editor', 'admin'] } },
      fields: {
        collection_id: 'ref:collections',
        author_id: 'ref:users',
        slug: 'slug required',
        title: 'string',
        status: 'enum(draft,review,published,archived)',
        published_at: 'datetime'
      }
    }
  }
}

let base, server, db
const at = (p) => `${base}${p}`
const login = async(email) => {
  const res = await fetch(at('/api/_auth/login'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'secret123' }) })
  return res.headers.getSetCookie()[0].split(';')[0]
}
const send = (method, p, cookie, obj) => fetch(at(p), { method, headers: { 'content-type': 'application/json', cookie }, body: obj && JSON.stringify(obj) })

let admin, author
before(async() => {
  wipe()
  // 1. Create the DB from pooppress's real migration, then seed two users.
  const seed = openDb(DB)
  seed.exec(SQL)
  const ins = seed.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
  ins.run('admin@t.dev', hashPassword('secret123'), 'admin')
  ins.run('author@t.dev', hashPassword('secret123'), 'author')
  seed.close()

  // 2. Point septic at that exact database.
  const built = createServer(config)
  db = built.db
  await new Promise((resolve) => { server = built.app.listen(0, resolve) })
  base = `http://localhost:${server.address().port}`
  admin = await login('admin@t.dev')
  author = await login('author@t.dev')
})
after(() => { server?.close(); db?.close(); wipe() })

test('septic did not touch pooppress schema (users keeps its own columns)', () => {
  const cols = db.prepare("PRAGMA table_info('users')").all().map((c) => c.name)
  for (const c of ['display_name', 'avatar_url', 'created_at', 'updated_at']) assert.ok(cols.includes(c), `lost ${c}`)
})

test('septic serves real CRUD on pooppress tables (create collection + post)', async() => {
  const c = await send('POST', '/api/collections', admin, { name: 'Blog', slug: 'blog' })
  assert.equal(c.status, 201)
  const col = await c.json()
  const p = await send('POST', '/api/posts', admin, { collection_id: col.id, author_id: 1, slug: 'hello', title: 'Hello', status: 'published' })
  assert.equal(p.status, 201)
  assert.equal((await p.json()).title, 'Hello')
})

test('field access holds on the real table: author cannot publish', async() => {
  const col = await (await send('POST', '/api/collections', admin, { name: 'C2', slug: 'c2' })).json()
  const post = await (await send('POST', '/api/posts', author, { collection_id: col.id, author_id: 2, slug: 'draftish', status: 'published' })).json()
  assert.equal(post.status, 'draft') // pooppress status column DEFAULT 'draft' applied after strip
})

test('pooppress COALESCE slug index is honoured: two null-collection pages collide', async() => {
  assert.equal((await send('POST', '/api/posts', admin, { slug: 'about', title: 'About' })).status, 201)
  assert.equal((await send('POST', '/api/posts', admin, { slug: 'about', title: 'About 2' })).status, 409)
})

test('query + expand work over the real schema', async() => {
  const published = await (await fetch(at('/api/posts?status=published'))).json()
  assert.ok(published.length >= 1)
  assert.ok(published.every((r) => r.status === 'published'))
  const [row] = await (await fetch(at('/api/posts?status=published&limit=1&expand=author_id'))).json()
  assert.equal(typeof row.author_id, 'object')
  assert.equal(row.author_id.email, 'admin@t.dev')
})
