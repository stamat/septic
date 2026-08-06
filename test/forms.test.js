import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseResource } from '../lib/schema.js'
import { formHtml, emitForms } from '../lib/forms.js'
import { validationMessage } from '../assets/septic-forms.js'
import { prepareDb, createServer } from '../lib/server.js'

// ── unit: the renderer ──────────────────────────────────────────────────────

const posts = parseResource('posts', {
  fields: {
    title: 'string required',
    slug: 'slug unique',
    body: 'text',
    status: 'enum(draft,review,published) = draft',
    created: 'datetime = now'
  }
})
const spec = { hints: { body: { widget: 'textarea', label: 'Post body' }, status: { help: 'Draft first' } } }

test('field DSL → inputs, with attrs, labels, and server-owned fields dropped', () => {
  const html = formHtml(posts, spec)
  assert.match(html, /<input id="posts-title" name="title" type="text" required>/)
  assert.match(html, /pattern="\[a-z0-9\]\[a-z0-9-\]\*"/)          // slug
  assert.match(html, /<textarea id="posts-body" name="body">/)      // text → textarea via hint
  assert.match(html, /<select id="posts-status"[^>]*>.*<option value="draft" selected>draft<\/option>/s)
  assert.match(html, /<label for="posts-body">Post body<\/label>/)  // hint label
  assert.match(html, /aria-describedby="posts-status-help"/)        // help wired
  assert.doesNotMatch(html, /name="created"/)                       // = now, server-owned
  assert.match(html, /hx-post="\/api\/posts"/)
  assert.match(html, /method="post" action="\/api\/posts"/)         // no-JS fallback
})

test('email field → native type="email" (client validation for free)', () => {
  const r = parseResource('contacts', { fields: { email: 'email required' } })
  assert.match(formHtml(r), /<input id="contacts-email" name="email" type="email" required>/)
})

test('a stored datetime prefills a datetime-local input in the shape the browser accepts', () => {
  const r = parseResource('events', { fields: { at: 'datetime' } })
  const html = formHtml(r, {}, { values: { at: '2026-08-06 12:30:00' } })
  assert.match(html, /type="datetime-local"[^>]* value="2026-08-06T12:30:00"/)
})

test('a checkbox renders over a hidden 0, so unchecking it posts a value', () => {
  const r = parseResource('flags', { fields: { featured: 'boolean = false' } })
  assert.match(formHtml(r), /<input type="hidden" name="featured" value="0"><input id="flags-featured" name="featured" type="checkbox" value="1">/)
})

test('validationMessage maps native validity → a message (no rules duplicated)', () => {
  assert.match(validationMessage({ valueMissing: true }, { label: 'Email' }), /Email is required/)
  assert.match(validationMessage({ typeMismatch: true }, { label: 'Email' }), /not valid/)
  assert.match(validationMessage({ patternMismatch: true }, { label: 'Slug' }), /right format/)
  assert.equal(validationMessage({}), 'Please fix this field')
})

test('re-render prefills submitted values and shows errors', () => {
  const html = formHtml(posts, spec, { values: { title: 'Kept', slug: 'Bad Slug' }, errors: { slug: 'bad slug', _: 'boom' } })
  assert.match(html, /value="Kept"/)                       // value survives a failed submit
  assert.match(html, /class="septic-error">bad slug/)      // field error
  assert.match(html, /role="alert">boom/)                  // form-level error
})

test('ref: select options come from the referenced table', () => {
  const ROOT = new URL('./tmp-forms-ref/', import.meta.url).pathname
  rmSync(ROOT, { recursive: true, force: true })
  const { db } = prepareDb({ dbPath: path.join(ROOT, 'r.db'), auth: {}, resources: { authors: { fields: { name: 'string required' } } } })
  db.prepare('INSERT INTO authors (name) VALUES (?)').run('Ada')
  const withRef = parseResource('books', { fields: { title: 'string required', author: 'ref:authors' } })
  const html = formHtml(withRef, { hints: { author: { optionLabel: 'name' } } }, { db })
  assert.match(html, /<select id="books-author"[^>]*>.*<option value="1">Ada<\/option>/s)
  db.close(); rmSync(ROOT, { recursive: true, force: true })
})

test('emitForms writes one partial per configured resource', () => {
  const ROOT = new URL('./tmp-forms-emit/', import.meta.url).pathname
  rmSync(ROOT, { recursive: true, force: true })
  const config = {
    root: ROOT,
    dbPath: path.join(ROOT, 'e.db'),
    auth: {},
    resources: { posts: { fields: { title: 'string required', slug: 'slug' } } },
    build: { forms: { posts: { into: 'src/markup/_partials' } } }
  }
  const { db } = prepareDb(config)
  const written = emitForms(config, db)
  db.close()
  const file = written.posts
  assert.ok(file.endsWith('posts-form.html'))
  assert.match(readFileSync(file, 'utf8'), /<form class="septic-form"/)
  rmSync(ROOT, { recursive: true, force: true })
})

// ── http: the forms actually work ───────────────────────────────────────────

const DB = new URL('./tmp-forms-http.db', import.meta.url).pathname
const wipe = () => ['', '-wal', '-shm'].forEach((s) => rmSync(DB + s, { force: true }))
const httpConfig = {
  dbPath: DB,
  auth: {},
  resources: {
    messages: {
      methods: ['GET', 'POST'],
      access: { read: 'admin', write: 'public' },
      fields: { name: 'string required', email: 'email required', body: 'text required', created: 'datetime = now' }
    }
  },
  build: { forms: { messages: { into: 'x', success: '/thanks' } } }
}

let base, server, db
const post = (headers, obj) => fetch(`${base}/api/messages`, { method: 'POST', headers, body: JSON.stringify(obj), redirect: 'manual' })

before(async() => {
  wipe()
  const built = createServer(httpConfig)
  db = built.db
  await new Promise((resolve) => { server = built.app.listen(0, resolve) })
  base = `http://localhost:${server.address().port}`
})
after(() => { server?.close(); db?.close(); wipe() })

test('HTMX submit, valid → 204 + HX-Redirect to success', async() => {
  const res = await post({ 'content-type': 'application/json', 'HX-Request': 'true' }, { name: 'A', email: 'a@b.c', body: 'hi' })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('HX-Redirect'), '/thanks')
})

test('HTMX submit, invalid → 422 with the form re-rendered (errors + values)', async() => {
  const res = await post({ 'content-type': 'application/json', 'HX-Request': 'true' }, { name: 'Only name' })
  assert.equal(res.status, 422)
  const html = await res.text()
  assert.match(html, /<form class="septic-form"/)
  assert.match(html, /value="Only name"/)                 // kept what they typed
  assert.match(html, /email&quot; is required/)            // and told them what's missing (HTML-escaped)
})

test('native browser submit, valid → 303 redirect (PRG)', async() => {
  const res = await post({ 'content-type': 'application/json', accept: 'text/html' }, { name: 'A', email: 'a@b.c', body: 'hi' })
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/thanks')
})

test('API client (JSON) still gets JSON, unchanged', async() => {
  const res = await post({ 'content-type': 'application/json' }, { name: 'A', email: 'a@b.c', body: 'hi' })
  assert.equal(res.status, 201)
  assert.equal((await res.json()).name, 'A')
})

test('server rejects a bad email (client validation is not the authority)', async() => {
  const res = await post({ 'content-type': 'application/json' }, { name: 'A', email: 'not-an-email', body: 'hi' })
  assert.equal(res.status, 422)
  assert.match((await res.json()).error, /email address/)
})
