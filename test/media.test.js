import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { createServer } from '../lib/server.js'
import { saveUpload } from '../lib/media.js'

// v0.3: file/image field types → multipart upload, stored path, image variants,
// the inline-extension allow-list, absolute media.url joining, a bad image → 422,
// an unexpected field → 400, and orphan-file rollback on a failed write.
// Deliberately not covered: sharp's own resize correctness beyond one width
// check — that is sharp's suite, not septic's; septic pins that a variant is
// produced at the configured width, not the resampling quality.
const ROOT = new URL('./tmp-media/', import.meta.url).pathname
const DB = path.join(ROOT, 'm.db')
const UP = path.join(ROOT, 'uploads')
const wipe = () => rmSync(ROOT, { recursive: true, force: true })

const config = {
  dbPath: DB,
  auth: {},
  media: { dir: UP, url: '/uploads', sizes: [8] },
  resources: {
    photos: { methods: ['GET', 'POST'], access: { read: 'public', write: 'public' }, fields: { alt: 'string', file: 'image' } },
    avatars: { methods: ['GET', 'POST'], access: { read: 'public', write: 'public' }, fields: { alt: 'string required', file: 'image' } },
    attachments: { methods: ['GET', 'POST'], access: { read: 'public', write: 'public' }, fields: { doc: 'file' } }
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

test('an uploaded .html cannot come back executable — the extension is dropped and sniffing is off', async() => {
  const fd = new FormData()
  fd.append('doc', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html')
  const res = await fetch(`${base}/api/attachments`, { method: 'POST', body: fd })
  assert.equal(res.status, 201)
  const row = await res.json()
  assert.match(row.doc, /^\/uploads\/[a-f0-9]+$/, 'stored without an extension')

  const served = await fetch(`${base}${row.doc}`)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'application/octet-stream')
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff')
})

test('an image claiming a script-capable extension takes the raw path, not sharp', async() => {
  const fd = new FormData()
  fd.append('doc', new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }), 'evil.svg')
  const res = await fetch(`${base}/api/attachments`, { method: 'POST', body: fd })
  assert.equal(res.status, 201)
  const row = await res.json()
  assert.match(row.doc, /^\/uploads\/[a-f0-9]+$/, 'svg is script-capable: no inline extension')
})

test('a harmless extension is kept', async() => {
  const fd = new FormData()
  fd.append('doc', new Blob(['plain'], { type: 'text/plain' }), 'notes.txt')
  const res = await fetch(`${base}/api/attachments`, { method: 'POST', body: fd })
  const row = await res.json()
  assert.match(row.doc, /\.txt$/)
})

test('an unexpected upload field is mapped to a 400, not a 500', async() => {
  const fd = new FormData()
  fd.append('nope', new Blob(['x'], { type: 'text/plain' }), 'x.txt')
  const res = await fetch(`${base}/api/photos`, { method: 'POST', body: fd })
  assert.equal(res.status, 400)
})

test('a file that is not the image its extension claims is a 422, not a 500', async() => {
  const fd = new FormData()
  fd.append('alt', 'x')
  fd.append('file', new Blob(['this is not a png'], { type: 'image/png' }), 'fake.png')
  const res = await fetch(`${base}/api/avatars`, { method: 'POST', body: fd })
  assert.equal(res.status, 422)
})

test('a valid upload rejected by validation leaves no orphan file on disk', async() => {
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 4, g: 5, b: 6 } } }).png().toBuffer()
  const before = readdirSync(UP).length
  const fd = new FormData()
  // alt is required and omitted, so the image saves then the insert fails 422
  fd.append('file', new Blob([png], { type: 'image/png' }), 'orphan.png')
  const res = await fetch(`${base}/api/avatars`, { method: 'POST', body: fd })
  assert.equal(res.status, 422)
  assert.equal(readdirSync(UP).length, before, 'the saved original and its variant were rolled back')
})

test('an absolute media.url survives — its scheme slashes are not collapsed', async() => {
  const meta = await saveUpload(
    { originalname: 'a.txt', mimetype: 'text/plain', size: 3, buffer: Buffer.from('hey') },
    { dir: UP, url: 'https://cdn.example.com/uploads' }
  )
  assert.match(meta.path, /^https:\/\/cdn\.example\.com\/uploads\/[a-f0-9]+\.txt$/)
})
