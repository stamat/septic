import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createServer, prepareDb } from '../lib/server.js'
import { parseResource } from '../lib/schema.js'
import { validateAll } from '../lib/validate.js'
import { hashPassword } from '../lib/auth.js'

const DB = new URL('./tmp-gaps.db', import.meta.url).pathname
const wipe = () => ['', '-wal', '-shm'].forEach((s) => rmSync(DB + s, { force: true }))

const config = {
  dbPath: DB,
  auth: { seed: { email: 'admin@t.dev', password: 'secret123', role: 'admin' } },
  resources: {
    collections: { methods: ['GET', 'POST', 'DELETE'], access: { read: 'public', write: 'admin' }, fields: { name: 'string required' } },
    posts: {
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      access: { read: 'public', write: ['author', 'editor', 'admin'] },
      fieldAccess: { status: { write: ['editor', 'admin'] } }, // authors can't publish
      unique: [['collection', 'slug']],
      indexes: [['status']],
      fields: {
        collection: 'ref:collections ondelete=cascade',
        slug: 'slug required',
        title: 'string',
        status: 'enum(draft,published) = draft',
        meta: 'json = {}',
        created: 'datetime = now',
        updated: 'datetime = now!'
      }
    }
  }
}

let base, server, db, admin, author
const at = (p) => `${base}${p}`
const login = async(email, password) => {
  const res = await fetch(at('/api/_auth/login'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  return res.headers.getSetCookie()[0].split(';')[0]
}
const send = (method, p, cookie, obj) => fetch(at(p), { method, headers: { 'content-type': 'application/json', cookie }, body: obj && JSON.stringify(obj) })

before(async() => {
  wipe()
  const built = createServer(config)
  db = built.db
  db.prepare('INSERT INTO users (email, role, password_hash) VALUES (?, ?, ?)').run('author@t.dev', 'author', hashPassword('secret123'))
  await new Promise((resolve) => { server = built.app.listen(0, resolve) })
  base = `http://localhost:${server.address().port}`
  admin = await login('admin@t.dev', 'secret123')
  author = await login('author@t.dev', 'secret123')
})
after(() => { server?.close(); db?.close(); wipe() })

test('json field round-trips as an object', async() => {
  const c = await (await send('POST', '/api/collections', admin, { name: 'C' })).json()
  const post = await (await send('POST', '/api/posts', admin, { collection: c.id, slug: 'j', meta: { hero: true, tags: ['a'] } })).json()
  assert.deepEqual(post.meta, { hero: true, tags: ['a'] })
  const got = await (await fetch(at(`/api/posts/${post.id}`))).json()
  assert.deepEqual(got.meta, { hero: true, tags: ['a'] })
})

test('touch field (updated = now!) is set on insert and re-set on update, never by the client', () => {
  const posts = parseResource('posts', config.resources.posts)
  const ins = validateAll(posts, { collection: 1, slug: 'x', updated: 'lies' }).data
  assert.ok(ins.updated && ins.updated !== 'lies')          // server owns it on insert
  const upd = validateAll(posts, { title: 'new' }, { insert: false }).data
  assert.ok(upd.updated)                                     // and re-stamped on update
  assert.equal(upd.created, undefined)                       // created (= now) is NOT touched on edit
})

test('a datetime is stored in one shape whatever shape the client sent', () => {
  const posts = parseResource('posts', config.resources.posts)
  const sql = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
  const fromPicker = validateAll(posts, { collection: 1, slug: 'dt', created: '2026-08-06T12:00' }).data
  assert.match(fromPicker.created, sql, 'datetime-local "T" shape normalized')
  const fromIso = validateAll(posts, { collection: 1, slug: 'dt2', created: '2026-08-06T10:00:00Z' }).data
  assert.equal(fromIso.created, '2026-08-06 10:00:00', 'an explicit UTC offset is kept as its UTC time')
})

test('composite unique: slug unique per collection, not globally', async() => {
  const a = await (await send('POST', '/api/collections', admin, { name: 'A' })).json()
  const b = await (await send('POST', '/api/collections', admin, { name: 'B' })).json()
  assert.equal((await send('POST', '/api/posts', admin, { collection: a.id, slug: 'dup' })).status, 201)
  assert.equal((await send('POST', '/api/posts', admin, { collection: a.id, slug: 'dup' })).status, 409) // same collection+slug
  assert.equal((await send('POST', '/api/posts', admin, { collection: b.id, slug: 'dup' })).status, 201) // other collection ok
})

test('field-level write access: author cannot publish, admin can', async() => {
  const c = await (await send('POST', '/api/collections', admin, { name: 'FA' })).json()
  const byAuthor = await (await send('POST', '/api/posts', author, { collection: c.id, slug: 'p1', status: 'published' })).json()
  assert.equal(byAuthor.status, 'draft')                     // status stripped for author
  const byAdmin = await (await send('POST', '/api/posts', admin, { collection: c.id, slug: 'p2', status: 'published' })).json()
  assert.equal(byAdmin.status, 'published')
})

test('composite unique with coalesce: null-collection pages still collide', () => {
  wipe()
  const { db: d } = prepareDb({
    dbPath: DB,
    auth: {},
    resources: {
      pages: {
        unique: [{ columns: ['collection', 'slug'], coalesce: { collection: 0 } }],
        fields: { collection: 'integer', slug: 'slug required' }
      }
    }
  })
  const ins = d.prepare('INSERT INTO pages (collection, slug) VALUES (?, ?)')
  ins.run(null, 'about') // first standalone page
  assert.throws(() => ins.run(null, 'about'), /UNIQUE/) // second, null collection → COALESCE(0) → collides
  ins.run(1, 'about') // same slug under a real collection is fine
  d.close(); wipe()
})

test('secondary index is created', () => {
  const idx = db.prepare("PRAGMA index_list('posts')").all().map((i) => i.name)
  assert.ok(idx.includes('ix_posts_status'))
})

test('FK ondelete=cascade removes children', async() => {
  const c = await (await send('POST', '/api/collections', admin, { name: 'Doomed' })).json()
  const p = await (await send('POST', '/api/posts', admin, { collection: c.id, slug: 'child' })).json()
  assert.equal((await send('DELETE', `/api/collections/${c.id}`, admin)).status, 204)
  assert.equal((await fetch(at(`/api/posts/${p.id}`))).status, 404) // cascaded away
})

test('extensible users: config can add columns to the auth users table', () => {
  wipe()
  const { db: d } = prepareDb({
    dbPath: DB,
    auth: {},
    resources: { users: { fields: { display_name: 'string', avatar_url: 'string' } } }
  })
  const cols = d.prepare("PRAGMA table_info('users')").all().map((c) => c.name)
  d.close(); wipe()
  for (const c of ['email', 'password_hash', 'role', 'display_name', 'avatar_url']) assert.ok(cols.includes(c), `missing ${c}`)
})
