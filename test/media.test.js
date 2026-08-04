import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { createServer } from '../lib/server.js'

// v0.3: file/image field types → multipart upload, stored path, image variants.
const ROOT = new URL('./tmp-media/', import.meta.url).pathname
const DB = path.join(ROOT, 'm.db')
const UP = path.join(ROOT, 'uploads')
const wipe = () => rmSync(ROOT, { recursive: true, force: true })

const config = {
  dbPath: DB,
  auth: {},
  media: { dir: UP, url: '/uploads', sizes: [8] },
  resources: {
    photos: { methods: ['GET', 'POST'], access: { read: 'public', write: 'public' }, fields: { alt: 'string', file: 'image' } }
  }
}

let base, server, db
before(async() => {
  wipe()
  const built = createServer(config)
  db = built.db
  await new Promise((resolve) => { server = built.app.listen(0, resolve) })
  base = `http://localhost:${server.address().port}`
})
after(() => { server?.close(); db?.close(); wipe() })

test('image upload → stored file, a path in the row, a resized variant, served', async() => {
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()
  const fd = new FormData()
  fd.append('alt', 'a pixel')
  fd.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png')

  const res = await fetch(`${base}/api/photos`, { method: 'POST', body: fd })
  assert.equal(res.status, 201)
  const row = await res.json()
  assert.equal(row.alt, 'a pixel')

  // image field is a hydrated metadata blob, not just a path
  assert.equal(typeof row.file, 'object')
  assert.match(row.file.path, /^\/uploads\/[a-f0-9]+\.png$/)
  assert.equal(row.file.name, 'pixel.png')
  assert.equal(row.file.mime, 'image/png')
  assert.equal(row.file.width, 16)
  assert.equal(row.file.height, 16)
  assert.deepEqual(row.file.variants.map((v) => v.width), [8])

  const name = path.basename(row.file.path)
  assert.ok(existsSync(path.join(UP, name)), 'original stored')
  assert.ok(existsSync(path.join(UP, `${name.replace(/\.png$/, '')}-8.png`)), 'variant written')

  const served = await fetch(`${base}${row.file.path}`)
  assert.equal(served.status, 200) // served statically
})

test('the variant is actually resized to the configured width', async() => {
  const variant = readdirSync(UP).find((f) => /-8\.png$/.test(f))
  assert.ok(variant)
  assert.equal((await sharp(path.join(UP, variant)).metadata()).width, 8)
})
