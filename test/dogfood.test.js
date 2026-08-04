import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { prepareDb } from '../lib/server.js'
import { parseResource } from '../lib/schema.js'
import { formHtml } from '../lib/forms.js'

// The 1.0 dogfood, as a check: a pooppress-shaped config (collections + posts,
// both refs, status enum) must produce the tables and a working posts form.
// See docs/DOGFOOD.md for the full mapping and the gaps this does NOT cover.
const ROOT = new URL('./tmp-dogfood/', import.meta.url).pathname
const wipe = () => rmSync(ROOT, { recursive: true, force: true })

const config = {
  dbPath: path.join(ROOT, 'cms.db'),
  auth: {},
  resources: {
    collections: {
      fields: {
        name: 'string required',
        slug: 'slug unique',
        sort_order: 'enum(asc,desc) = desc',
        paginate: 'integer',
        layout: 'string = post'
      }
    },
    posts: {
      fields: {
        collection: 'ref:collections',
        author: 'ref:users',            // septic already owns the users table
        slug: 'slug required',
        title: 'string',
        body: 'text',
        status: 'enum(draft,review,published,archived) = draft',
        published_at: 'datetime',
        created: 'datetime = now'
      }
    }
  }
}

let db
before(() => {
  wipe()
  db = prepareDb(config).db
})
after(() => { db?.close(); wipe() })

test('septic creates the CMS tables from config (users, collections, posts)', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  for (const t of ['users', 'collections', 'posts']) assert.ok(tables.includes(t), `missing table ${t}`)
})

test('a posts form generates ref selects and the status enum, from one config', () => {
  db.prepare('INSERT INTO collections (name, slug, sort_order, layout) VALUES (?, ?, ?, ?)').run('Blog', 'blog', 'desc', 'post')
  db.prepare('INSERT INTO users (email, role, password_hash) VALUES (?, ?, ?)').run('a@t.dev', 'admin', 'x')

  const posts = parseResource('posts', config.resources.posts)
  const html = formHtml(posts, { hints: { collection: { optionLabel: 'name' }, author: { optionLabel: 'email' } } }, { db })

  assert.match(html, /<select id="posts-collection"[^>]*>.*<option value="1">Blog<\/option>/s)   // ref:collections
  assert.match(html, /<select id="posts-author"[^>]*>.*<option value="1">a@t\.dev<\/option>/s)    // ref:users (septic's own)
  assert.match(html, /<select id="posts-status"[^>]*>.*<option value="draft" selected>draft/s)     // enum + default
  assert.doesNotMatch(html, /name="created"/)                                                       // = now, server-owned
})
