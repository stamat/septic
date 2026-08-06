import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createServer } from '../lib/server.js'

// v0.5: edit forms. Retrieve the prefilled form by GETting the row as a writer;
// submit as PUT (HTMX) or POST + _method (no JS). Server-owned fields survive.
const DB = new URL('./tmp-edit.db', import.meta.url).pathname
const wipe = () => ['', '-wal', '-shm'].forEach((s) => rmSync(DB + s, { force: true }))

const config = {
  dbPath: DB,
  auth: { seed: { email: 'a@t.dev', password: 'secret123', role: 'admin' } },
  resources: {
    posts: {
      methods: ['GET', 'POST', 'PUT'],
      access: { read: 'public', write: 'admin' },
      fields: { title: 'string required', slug: 'slug unique', body: 'text', featured: 'boolean = false', created: 'datetime = now' }
    }
  },
  build: { forms: { posts: { into: 'x' } } }
}

let base, server, db, cookie, id
const at = (p) => `${base}${p}`
const json = (p, headers) => fetch(at(p), { headers }).then((r) => r.json())

before(async() => {
  wipe()
  const built = createServer(config)
  db = built.db
  await new Promise((resolve) => { server = built.app.listen(0, resolve) })
  base = `http://localhost:${server.address().port}`
  const login = await fetch(at('/api/_auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@t.dev', password: 'secret123' })
  })
  cookie = login.headers.getSetCookie()[0].split(';')[0]
  const created = await fetch(at('/api/posts'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ title: 'First', slug: 'first', body: 'hi' })
  })
  id = (await created.json()).id
})
after(() => { server?.close(); db?.close(); wipe() })

test('GET row as a writer wanting HTML → prefilled edit form (PUT + _method)', async() => {
  const res = await fetch(at(`/api/posts/${id}`), { headers: { cookie, accept: 'text/html' } })
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, new RegExp(`hx-put="/api/posts/${id}"`))
  assert.match(html, /name="_method" value="PUT"/)
  assert.match(html, /value="First"/)          // prefilled
  assert.match(html, /value="first"/)
})

test('GET row without write access → JSON, not a form', async() => {
  const res = await fetch(at(`/api/posts/${id}`), { headers: { accept: 'text/html' } }) // no cookie
  assert.equal(res.status, 200)
  assert.equal((await res.json()).title, 'First')
})

test('edit submit (HTMX PUT), invalid → 422 edit form re-rendered', async() => {
  const res = await fetch(at(`/api/posts/${id}`), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie, 'HX-Request': 'true' },
    body: JSON.stringify({ title: '', slug: 'first' })
  })
  assert.equal(res.status, 422)
  const html = await res.text()
  assert.match(html, /name="_method" value="PUT"/)   // still an edit form
  assert.match(html, /is required/)
})

test('edit submit (HTMX PUT), valid → saved, and created is NOT reset', async() => {
  const before = await json(`/api/posts/${id}`)
  const res = await fetch(at(`/api/posts/${id}`), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie, 'HX-Request': 'true' },
    body: JSON.stringify({ title: 'Edited', slug: 'first', body: 'hi' })
  })
  assert.equal(res.status, 200)
  assert.match(await res.text(), /septic-form-success/)
  const after = await json(`/api/posts/${id}`)
  assert.equal(after.title, 'Edited')
  assert.equal(after.created, before.created)   // datetime = now not clobbered on edit
})

test('unchecking a checkbox on the edit form turns the boolean off', async() => {
  // On first, via JSON partial PUT.
  await fetch(at(`/api/posts/${id}`), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ featured: true })
  })
  assert.equal((await json(`/api/posts/${id}`)).featured, true)
  // A real unchecked submit: only the hidden 0 posts.
  const res = await fetch(at(`/api/posts/${id}`), {
    method: 'PUT',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, 'HX-Request': 'true' },
    body: 'title=First&slug=first&featured=0'
  })
  assert.equal(res.status, 200)
  assert.equal((await json(`/api/posts/${id}`)).featured, false)
})

test('a checked checkbox posts ["0","1"] over its hidden fallback and stays on', async() => {
  const res = await fetch(at(`/api/posts/${id}`), {
    method: 'PUT',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, 'HX-Request': 'true' },
    body: 'title=First&slug=first&featured=0&featured=1'
  })
  assert.equal(res.status, 200)
  assert.equal((await json(`/api/posts/${id}`)).featured, true)
})

test('native edit via _method=PUT override, valid → 303 redirect', async() => {
  const res = await fetch(at(`/api/posts/${id}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, accept: 'text/html' },
    body: JSON.stringify({ _method: 'PUT', title: 'Native', slug: 'first' }),
    redirect: 'manual'
  })
  assert.equal(res.status, 303)
})
