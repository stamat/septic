import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createServer } from '../lib/server.js'
import { createStore, AccessError, NotFoundError } from '../lib/data.js'
import { ValidationError } from '../lib/validate.js'
import { parseResources } from '../lib/schema.js'

// The data layer a host application composes septic through — the same calls the
// REST router makes, reached without HTTP. What matters here is that it enforces
// what the API enforces: access rules per call, fieldAccess per field, reads
// shaped to the declared fields, expand obeying the target's own read rule.
//
// Deliberately not covered: the HTTP surface over these calls (crud.test.js and
// leaks.test.js own that), and multipart uploads (media.test.js — the store
// takes a value, never a file).
const DB = new URL('./tmp-data.db', import.meta.url).pathname
const wipe = () => ['', '-wal', '-shm'].forEach((s) => rmSync(DB + s, { force: true }))

const resources = {
  posts: {
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    access: { read: 'public', write: ['author', 'editor'] },
    // An author writes, an editor publishes — the rule pooppress has, and the
    // one that makes fieldAccess worth enforcing below the router.
    fieldAccess: { status: { write: 'editor' } },
    fields: {
      title: 'string required',
      slug: 'slug unique',
      status: 'enum(draft,published) = draft',
      author_id: 'ref:writers'
    }
  },
  writers: {
    methods: ['GET'],
    access: { read: 'editor', write: 'editor' },
    fields: { name: 'string required' }
  }
}

const anon = undefined
const author = { id: 1, role: 'author' }
const editor = { id: 2, role: 'editor' }

let db, posts, writers

before(() => {
  wipe()
  const built = createServer({ dbPath: DB, resources })
  db = built.db
  const store = createStore(db, parseResources(resources))
  posts = store.posts
  writers = store.writers
  // An undeclared column on a served table: the shape of the password_hash leak
  // septic closed, reproduced here so the store is held to the same promise.
  db.exec('ALTER TABLE "posts" ADD COLUMN "internal_note" TEXT')
})

after(() => { db?.close(); wipe() })

test('a read returns the declared fields and leaves an undeclared column in the database', () => {
  const created = posts.create({ title: 'Hello', slug: 'hello' }, { user: editor })
  db.prepare('UPDATE posts SET internal_note = ? WHERE id = ?').run('not for callers', created.id)

  const row = posts.get(created.id, { user: anon })
  assert.equal(row.title, 'Hello', 'a declared field is missing')
  assert.ok(!('internal_note' in row), 'an undeclared column reached the caller')
  assert.ok(!('internal_note' in posts.list({ user: anon })[0]), 'an undeclared column reached a list caller')
})

test('the whole row is still reachable, by asking for it by name', () => {
  const [row] = posts.list({ user: anon })
  assert.equal(posts.raw(row.id, { user: anon }).internal_note, 'not for callers', 'raw() did not hand back the stored row')
})

test('omitting the user reads as anonymous, so a guarded resource fails closed', () => {
  assert.throws(() => writers.list(), AccessError, 'a forgotten user argument opened a guarded read')
  assert.throws(() => writers.list({}), AccessError, 'an empty options object opened a guarded read')
})

test('an anonymous caller is unauthorized and a known one forbidden, so a client knows whether logging in helps', () => {
  try {
    writers.list({ user: anon })
    assert.fail('an anonymous read was allowed')
  } catch (err) { assert.equal(err.status, 401, 'anonymous should be unauthorized') }

  try {
    writers.list({ user: author })
    assert.fail('an author read a resource only editors may read')
  } catch (err) { assert.equal(err.status, 403, 'a known user should be forbidden') }
})

test('a field the user may not write is dropped, not rejected — the rest of the edit survives', () => {
  const row = posts.create({ title: 'Author draft', slug: 'author-draft', status: 'published' }, { user: author })
  assert.equal(row.title, 'Author draft', 'the writable fields did not land')
  assert.equal(row.status, 'draft', "an author's status=published was applied instead of dropped")
})

test('the same field is writable by someone the rule names', () => {
  const row = posts.create({ title: 'Editor post', slug: 'editor-post', status: 'published' }, { user: editor })
  assert.equal(row.status, 'published', 'an editor could not set the field their rule allows')
})

test('a write by someone with no write rule is refused before anything is validated', () => {
  assert.throws(() => posts.create({ title: '' }, { user: anon }), AccessError, 'an anonymous create was allowed')
})

test("expand obeys the referenced resource's own read rule, not the referring one", () => {
  const writerId = writers.create({ name: 'Ada' }, { user: editor }).id
  const post = posts.create({ title: 'Referred', slug: 'referred', author_id: writerId }, { user: editor })

  const forAnon = posts.get(post.id, { user: anon, expand: 'author_id' })
  assert.equal(forAnon.author_id, writerId, 'a public reader expanded a ref into an editors-only table')

  const forEditor = posts.get(post.id, { user: editor, expand: 'author_id' })
  assert.equal(forEditor.author_id.name, 'Ada', 'an editor could not expand a ref they are allowed to read')
})

test('a missing row is a not-found, distinguishable from a refusal', () => {
  assert.throws(() => posts.get(9999, { user: anon }), NotFoundError, 'a missing row did not report itself')
  assert.throws(() => posts.remove(9999, { user: editor }), NotFoundError, 'deleting nothing reported success')
})

test("a validation failure carries every field's error, not only the first", () => {
  try {
    posts.create({ slug: 'NOT A SLUG' }, { user: editor })
    assert.fail('an invalid create was accepted')
  } catch (err) {
    assert.ok(err instanceof ValidationError, 'the failure was not a ValidationError')
    assert.ok(err.errors.title, 'the missing required title was not reported')
    assert.ok(err.errors.slug, 'the malformed slug was not reported')
  }
})

test('a partial update touches only what it was given', () => {
  const row = posts.create({ title: 'Before', slug: 'partial-update' }, { user: editor })
  const updated = posts.update(row.id, { title: 'After' }, { user: editor, partial: true })
  assert.equal(updated.title, 'After', 'the sent field did not change')
  assert.equal(updated.slug, 'partial-update', 'an unsent field was cleared by a partial update')
})

test("an explicit null clears a nullable field on a partial update; '' leaves it alone", () => {
  const w = writers.create({ name: 'W' }, { user: editor })
  const row = posts.create({ title: 'Clearable', slug: 'clearable', author_id: w.id }, { user: editor })
  const kept = posts.update(row.id, { title: 'Still linked', author_id: '' }, { user: editor, partial: true })
  assert.equal(kept.author_id, w.id, "'' is a form absence, not a clear")
  const cleared = posts.update(row.id, { author_id: null }, { user: editor, partial: true })
  assert.equal(cleared.author_id, null, 'null did not clear the reference')
})

test('null cannot clear a required field', () => {
  const row = posts.create({ title: 'Keeps title', slug: 'keeps-title' }, { user: editor })
  assert.throws(() => posts.update(row.id, { title: null }, { user: editor, partial: true }),
    { name: 'ValidationError' }, 'a required field accepted null')
})

test('a duplicate on a unique field is a conflict, not a crash', () => {
  posts.create({ title: 'First', slug: 'taken' }, { user: editor })
  try {
    posts.create({ title: 'Second', slug: 'taken' }, { user: editor })
    assert.fail('a duplicate slug was accepted')
  } catch (err) { assert.equal(err.status, 409, 'a duplicate should be a conflict') }
})

test('counting obeys the same read rule as listing', () => {
  assert.ok(posts.count({ user: anon }) > 0, 'a public count came back empty')
  assert.throws(() => writers.count({ user: author }), AccessError, 'an author counted an editors-only table')
})
