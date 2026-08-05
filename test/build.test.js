import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { prepareDb } from '../lib/server.js'
import { build, toMarkup } from '../lib/build.js'

// The moat: DB rows → poops markup. Pins the part septic owns (markup
// emission); the poops child process is exercised with compile:false.
const ROOT = new URL('./tmp-build/', import.meta.url).pathname
const DB = path.join(ROOT, 'app.db')
const wipe = () => rmSync(ROOT, { recursive: true, force: true })

const config = {
  root: ROOT,
  dbPath: DB,
  auth: {},
  resources: {
    posts: {
      fields: {
        title: 'string required',
        slug: 'slug unique',
        body: 'text',
        status: 'enum(draft,published) = draft',
        created: 'datetime = now'
      }
    }
  },
  build: {
    resources: {
      posts: { into: 'src/markup/posts', slug: 'slug', body: 'body', layout: 'post.html' }
    }
  }
}

let db
before(() => {
  wipe()
  db = prepareDb(config).db
  db.prepare('INSERT INTO posts (title, slug, body, status, created) VALUES (?, ?, ?, ?, ?)')
    .run('Hello World', 'hello-world', '# Hi\n\nBody text.', 'published', '2026-08-03 12:00:00')
  db.prepare('INSERT INTO posts (title, slug, body, status, created) VALUES (?, ?, ?, ?, ?)')
    .run('Second', 'second', 'More.', 'draft', '2026-08-03 13:00:00')
})
after(() => { db?.close(); wipe() })

test('toMarkup: fields → front matter, body → document body, nulls dropped', () => {
  const md = toMarkup({ id: 1, title: 'T', slug: 's', body: 'B', missing: null }, { body: 'body', layout: 'post.html' })
  assert.match(md, /^---\n/)
  assert.match(md, /title: T/)
  assert.match(md, /layout: post\.html/)
  assert.doesNotMatch(md, /missing/)        // null dropped
  assert.doesNotMatch(md, /body:/)          // body is not front matter
  assert.match(md, /\n---\n\nB\n$/)         // body after the fence
})

test('build emits one markup file per row (compile:false)', async() => {
  const { written, compiled } = await build(config, db, { compile: false })
  assert.equal(written.posts, 2)
  assert.equal(compiled, false)

  const dir = path.join(ROOT, 'src/markup/posts')
  assert.deepEqual(readdirSync(dir).sort(), ['hello-world.md', 'second.md'])

  const md = readFileSync(path.join(dir, 'hello-world.md'), 'utf8')
  assert.match(md, /title: Hello World/)
  assert.match(md, /status: published/)
  assert.match(md, /layout: post\.html/)
  assert.match(md, /# Hi\n\nBody text\.\n$/)
})

test('build regenerates clean — deleted rows leave no orphan files', async() => {
  db.prepare('DELETE FROM posts WHERE slug = ?').run('second')
  await build(config, db, { compile: false })
  const dir = path.join(ROOT, 'src/markup/posts')
  assert.equal(existsSync(path.join(dir, 'second.md')), false)
  assert.deepEqual(readdirSync(dir), ['hello-world.md'])
})

test('build "where" filter emits only matching rows (drafts stay out)', async() => {
  const ROOT2 = new URL('./tmp-where/', import.meta.url).pathname
  rmSync(ROOT2, { recursive: true, force: true })
  const cfg = {
    root: ROOT2,
    dbPath: path.join(ROOT2, 'w.db'),
    auth: {},
    resources: { posts: config.resources.posts },
    build: { resources: { posts: { into: 'out', slug: 'slug', body: 'body', where: { status: 'published' } } } }
  }
  const { db: d } = prepareDb(cfg)
  d.prepare('INSERT INTO posts (title, slug, body, status) VALUES (?, ?, ?, ?)').run('Pub', 'pub', 'x', 'published')
  d.prepare('INSERT INTO posts (title, slug, body, status) VALUES (?, ?, ?, ?)').run('Draft', 'draft', 'x', 'draft')
  await build(cfg, d, { compile: false })
  const files = readdirSync(path.join(ROOT2, 'out')).sort()
  d.close()
  assert.deepEqual(files, ['pub.md']) // draft not emitted
  rmSync(ROOT2, { recursive: true, force: true })
})
