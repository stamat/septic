import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createServer } from '../lib/server.js'

// The one runnable check the spine leaves behind: config → table → CRUD →
// validate → auth, exercised over real HTTP. If any link breaks, this fails.
const DB = new URL('./tmp-test.db', import.meta.url).pathname
const wipe = () => ['', '-wal', '-shm'].forEach((s) => rmSync(DB + s, { force: true }))

const config = {
  dbPath: DB,
  auth: { seed: { email: 'admin@test.dev', password: 'secret123', role: 'admin' } },
  resources: {
    posts: {
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      access: { read: 'public', write: 'admin' },
      fields: {
        title: 'string required',
        slug: 'slug unique',
        body: 'text',
        status: 'enum(draft,review,published) = draft',
        created: 'datetime = now'
      }
    },
    authors: { methods: ['GET'], access: { read: 'public' }, fields: { name: 'string required' } }
  }
}

let base, server, db
const url = (p) => `${base}${p}`

before(async () => {
  wipe()
  const built = createServer(config)
  db = built.db
  await new Promise((res) => { server = built.app.listen(0, res) })
  base = `http://localhost:${server.address().port}`
})

after(() => { server?.close(); db?.close(); wipe() })

async function login() {
  const res = await fetch(url('/api/_auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.dev', password: 'secret123' })
  })
  assert.equal(res.status, 200)
  return res.headers.getSetCookie()[0].split(';')[0] // "septic_session=..."
}
const authed = async () => ({ 'content-type': 'application/json', cookie: await login() })

test('unauthorized write is rejected (401)', async () => {
  const res = await fetch(url('/api/posts'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Hi', slug: 'hi' })
  })
  assert.equal(res.status, 401)
})

test('CRUD roundtrip as admin, defaults applied, public read', async () => {
  const h = await authed()

  let res = await fetch(url('/api/posts'), { method: 'POST', headers: h, body: JSON.stringify({ title: 'Hello', slug: 'hello', body: 'world' }) })
  assert.equal(res.status, 201)
  const post = await res.json()
  assert.equal(post.title, 'Hello')
  assert.equal(post.status, 'draft')     // enum default
  assert.ok(post.created)                // datetime = now
  assert.ok(post.id)

  res = await fetch(url(`/api/posts/${post.id}`)) // public, no cookie
  assert.equal(res.status, 200)
  assert.equal((await res.json()).slug, 'hello')

  res = await fetch(url('/api/posts'))
  assert.equal((await res.json()).length, 1)

  res = await fetch(url(`/api/posts/${post.id}`), { method: 'PUT', headers: h, body: JSON.stringify({ status: 'published' }) })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).status, 'published')

  res = await fetch(url(`/api/posts/${post.id}`), { method: 'DELETE', headers: h })
  assert.equal(res.status, 204)
  assert.equal((await fetch(url(`/api/posts/${post.id}`))).status, 404)
})

test('validation: bad enum and bad slug → 422', async () => {
  const h = await authed()
  let res = await fetch(url('/api/posts'), { method: 'POST', headers: h, body: JSON.stringify({ title: 'X', slug: 'ok', status: 'nope' }) })
  assert.equal(res.status, 422)
  res = await fetch(url('/api/posts'), { method: 'POST', headers: h, body: JSON.stringify({ title: 'X', slug: 'Bad Slug!' }) })
  assert.equal(res.status, 422)
})

test('missing required field → 422', async () => {
  const h = await authed()
  const res = await fetch(url('/api/posts'), { method: 'POST', headers: h, body: JSON.stringify({ slug: 'no-title' }) })
  assert.equal(res.status, 422)
})

test('unique constraint → 409', async () => {
  const h = await authed()
  await fetch(url('/api/posts'), { method: 'POST', headers: h, body: JSON.stringify({ title: 'A', slug: 'dup' }) })
  const res = await fetch(url('/api/posts'), { method: 'POST', headers: h, body: JSON.stringify({ title: 'B', slug: 'dup' }) })
  assert.equal(res.status, 409)
})

test('read-only resource has no POST route (404)', async () => {
  const h = await authed()
  const res = await fetch(url('/api/authors'), { method: 'POST', headers: h, body: JSON.stringify({ name: 'X' }) })
  assert.equal(res.status, 404)
})
