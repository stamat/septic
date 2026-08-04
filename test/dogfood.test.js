import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { prepareDb } from '../lib/server.js'
import { parseResource } from '../lib/schema.js'
import { formHtml } from '../lib/forms.js'

// The 1.0 dogfood: pooppress's whole schema (server/migrations/001-init.sql)
// expressed as a septic config, and proven to build. See docs/DOGFOOD.md.
const ROOT = new URL('./tmp-dogfood/', import.meta.url).pathname
const wipe = () => rmSync(ROOT, { recursive: true, force: true })

const config = {
  dbPath: path.join(ROOT, 'cms.db'),
  auth: {},
  resources: {
    // users: extends septic's own auth users table with pooppress's columns
    users: { fields: { display_name: 'string', avatar_url: 'string', bio: 'text' } },
    collections: {
      fields: {
        name: 'string required',
        slug: 'slug unique',
        sort_by: 'string = published_at',
        sort_order: 'enum(asc,desc) = desc',
        paginate: 'integer',
        permalink: 'string',
        layout: 'string = post',
        index_layout: 'string = collection',
        created: 'datetime = now',
        updated: 'datetime = now!'
      }
    },
    posts: {
      access: { read: 'public', write: ['author', 'editor', 'admin'] },
      fieldAccess: { status: { write: ['editor', 'admin'] } },
      unique: [{ columns: ['collection', 'slug'], coalesce: { collection: 0 } }],
      indexes: [['status', 'published_at'], ['collection']],
      fields: {
        collection: 'ref:collections ondelete=restrict',
        author: 'ref:users ondelete=setnull',
        slug: 'slug required',
        title: 'string',
        body_markdown: 'text',
        excerpt: 'text',
        status: 'enum(draft,review,published,archived) = draft',
        published_at: 'datetime',
        meta: 'json = {}',
        created: 'datetime = now',
        updated: 'datetime = now!'
      }
    },
    media: {
      fields: {
        original_name: 'string required',
        file: 'image required',
        mime_type: 'string',
        alt_text: 'string',
        variants: 'json = []',
        created: 'datetime = now'
      }
    },
    settings: { fields: { key: 'slug required unique', value: 'json' } }
  }
}

let db
before(() => { wipe(); db = prepareDb(config).db })
after(() => { db?.close(); wipe() })

test('all six pooppress tables build from the config', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  for (const t of ['users', 'collections', 'posts', 'media', 'settings']) assert.ok(tables.includes(t), `missing ${t}`)
})

test('the users table gains pooppress columns on top of septic auth', () => {
  const cols = db.prepare("PRAGMA table_info('users')").all().map((c) => c.name)
  for (const c of ['email', 'password_hash', 'role', 'display_name', 'avatar_url', 'bio']) assert.ok(cols.includes(c), `missing ${c}`)
})

test('posts carries the touch column, composite unique, and both indexes', () => {
  const cols = db.prepare("PRAGMA table_info('posts')").all().map((c) => c.name)
  assert.ok(cols.includes('updated'))
  const idx = db.prepare("PRAGMA index_list('posts')").all().map((i) => i.name)
  assert.ok(idx.includes('ux_posts_collection_slug'))
  assert.ok(idx.includes('ix_posts_status_published_at'))
  assert.ok(idx.includes('ix_posts_collection'))
})

test('posts foreign keys carry their on-delete actions', () => {
  const fks = db.prepare("PRAGMA foreign_key_list('posts')").all()
  const byTable = Object.fromEntries(fks.map((f) => [f.table, f.on_delete]))
  assert.equal(byTable.collections, 'RESTRICT')
  assert.equal(byTable.users, 'SET NULL')
})

test('a posts form generates ref selects and the status enum from one config', () => {
  db.prepare('INSERT INTO collections (name, slug) VALUES (?, ?)').run('Blog', 'blog')
  db.prepare('INSERT INTO users (email, role, password_hash, display_name) VALUES (?, ?, ?, ?)').run('a@t.dev', 'admin', 'x', 'Ada')
  const posts = parseResource('posts', config.resources.posts)
  const html = formHtml(posts, { hints: { collection: { optionLabel: 'name' }, author: { optionLabel: 'display_name' } } }, { db })
  assert.match(html, /<select id="posts-collection"[^>]*>.*<option value="1">Blog<\/option>/s)
  assert.match(html, /<select id="posts-author"[^>]*>.*<option value="1">Ada<\/option>/s)
  assert.match(html, /<option value="draft" selected>draft/)
  assert.doesNotMatch(html, /name="created"/) // server-owned
})
