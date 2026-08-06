import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createServer } from '../lib/server.js'
import { allows } from '../lib/auth.js'

// v0.2: list querying (sort/order/filter over the existing pagination),
// relation expand, and array access rules.
const DB = new URL('./tmp-query.db', import.meta.url).pathname
const wipe = () => ['', '-wal', '-shm'].forEach((s) => rmSync(DB + s, { force: true }))

const config = {
  dbPath: DB,
  auth: {},
  resources: {
    authors: { methods: ['GET', 'POST'], access: { read: 'public', write: 'public' }, fields: { name: 'string required' } },
    posts: {
      methods: ['GET', 'POST'],
      access: { read: 'public', write: 'public' },
      fields: { title: 'string required', status: 'enum(draft,published) = draft', author: 'ref:authors' }
    }
  }
}

let base, server, db
const at = (p) => `${base}${p}`
const get = (p) => fetch(at(p)).then((r) => r.json())
const make = (p, obj) => fetch(at(p), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) }).then((r) => r.json())

before(async() => {
  wipe()
  const built = createServer(config)
  db = built.db
  await new Promise((resolve) => { server = built.app.listen(0, resolve) })
  base = `http://localhost:${server.address().port}`
  const ada = await make('/api/authors', { name: 'Ada' })
  await make('/api/posts', { title: 'Alpha', status: 'published', author: ada.id })
  await make('/api/posts', { title: 'Beta', status: 'draft', author: ada.id })
  await make('/api/posts', { title: 'Gamma', status: 'published', author: ada.id })
})
after(() => { server?.close(); db?.close(); wipe() })

test('filter by a column', async() => {
  const rows = await get('/api/posts?status=published')
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.status === 'published'))
})

test('unknown query params are ignored, not errors', async() => {
  const res = await fetch(at('/api/posts?utm_source=x&nope=1'))
  assert.equal(res.status, 200)
  assert.equal((await res.json()).length, 3)
})

test('sort + order', async() => {
  const asc = await get('/api/posts?sort=title&order=asc')
  assert.deepEqual(asc.map((r) => r.title), ['Alpha', 'Beta', 'Gamma'])
  const desc = await get('/api/posts?sort=title&order=desc')
  assert.deepEqual(desc.map((r) => r.title), ['Gamma', 'Beta', 'Alpha'])
})

test('pagination: limit + offset', async() => {
  const page = await get('/api/posts?sort=title&order=asc&limit=1&offset=1')
  assert.deepEqual(page.map((r) => r.title), ['Beta'])
})

test('a negative limit cannot lift the cap — SQLite reads LIMIT -1 as unlimited', async() => {
  const rows = await get('/api/posts?limit=-1')
  assert.ok(rows.length >= 1 && rows.length <= 200, `got ${rows.length} rows`)
  const one = await get('/api/posts?limit=-5')
  assert.equal(one.length, 1, 'clamped to the floor of 1, not passed to SQL')
})

test('a negative offset reads as 0, not as SQL', async() => {
  const rows = await get('/api/posts?sort=title&order=asc&limit=1&offset=-3')
  assert.deepEqual(rows.map((r) => r.title), ['Alpha'])
})

test('expand: ref id → the referenced row', async() => {
  const [row] = await get('/api/posts?sort=title&order=asc&limit=1&expand=author')
  assert.equal(typeof row.author, 'object')
  assert.equal(row.author.name, 'Ada')
})

test('expand on a single row', async() => {
  const list = await get('/api/posts')
  const one = await get(`/api/posts/${list[0].id}?expand=author`)
  assert.equal(one.author.name, 'Ada')
})

test('allows(): array of roles, admin superuser, public', () => {
  assert.equal(allows(null, 'public'), true)
  assert.equal(allows(null, ['editor', 'admin']), false)
  assert.equal(allows({ role: 'editor' }, ['editor', 'writer']), true)
  assert.equal(allows({ role: 'writer' }, ['editor']), false)
  assert.equal(allows({ role: 'admin' }, ['editor']), true)   // admin passes everything
})
