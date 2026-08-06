import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

// sharp is heavy; load it lazily and tolerate its absence — a non-image upload,
// or a deploy without sharp, still stores the file, just without variants.
let sharpMod
async function getSharp() {
  if (sharpMod === undefined) {
    try { sharpMod = (await import('sharp')).default } catch { sharpMod = null }
  }
  return sharpMod
}

const isImage = (mime) => /^image\//.test(mime || '')

// Extensions safe to serve inline from the same origin. Uploads are served by
// express.static, which maps extension → Content-Type, so an uploaded .html
// (or .svg — scripts run on navigation) would execute as the site itself.
// Anything not listed is stored extension-less: served as
// application/octet-stream, downloaded, never executed. The original filename
// survives in meta.name.
const INLINE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
  '.mp3', '.mp4', '.webm', '.ogg', '.wav',
  '.pdf', '.txt', '.zip'
])

const pub = (url, name) => `${url}/${name}`.replace(/\/{2,}/g, '/')

// Store one uploaded file under media.dir with a random name, and for images
// write a resized variant per configured width alongside. Returns full metadata:
// { path, name, mime, size, width?, height?, variants? }. A `file` field keeps
// only `.path`; an `image` field stores the whole object (so width/height and
// the variant list live in the row — closing the media-metadata gap).
export async function saveUpload(file, media = {}) {
  const dir = media.dir || 'data/uploads'
  const url = media.url || '/uploads'
  mkdirSync(dir, { recursive: true })
  const rawExt = path.extname(file.originalname || '').toLowerCase()
  const ext = INLINE_EXT.has(rawExt) ? rawExt : ''
  const base = randomBytes(8).toString('hex')
  const name = `${base}${ext}`

  const meta = { path: pub(url, name), name: file.originalname, mime: file.mimetype, size: file.size }

  // sharp infers the output format from the extension, so an extension-less
  // name (a claimed image with a disallowed extension) takes the raw-write path.
  const sharp = ext && isImage(file.mimetype) ? await getSharp() : null
  if (sharp) {
    await sharp(file.buffer).toFile(path.join(dir, name))
    const { width, height } = await sharp(file.buffer).metadata()
    meta.width = width
    meta.height = height
    meta.variants = []
    for (const w of media.sizes || []) {
      await sharp(file.buffer).resize({ width: w, withoutEnlargement: true }).toFile(path.join(dir, `${base}-${w}${ext}`))
      meta.variants.push({ width: w, path: pub(url, `${base}-${w}${ext}`) })
    }
  } else {
    writeFileSync(path.join(dir, name), file.buffer)
  }
  return meta
}
