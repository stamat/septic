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
  const ext = path.extname(file.originalname || '').toLowerCase()
  const base = randomBytes(8).toString('hex')
  const name = `${base}${ext}`

  const meta = { path: pub(url, name), name: file.originalname, mime: file.mimetype, size: file.size }

  const sharp = isImage(file.mimetype) ? await getSharp() : null
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
