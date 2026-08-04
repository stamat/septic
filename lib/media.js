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

// Store one uploaded file under media.dir with a random name, and for images
// write a resized variant per configured width alongside. Returns the public
// path to store in the row (variants share its base name: `<base>-<width><ext>`).
export async function saveUpload(file, media = {}) {
  const dir = media.dir || 'data/uploads'
  const url = media.url || '/uploads'
  mkdirSync(dir, { recursive: true })
  const ext = path.extname(file.originalname || '').toLowerCase()
  const base = randomBytes(8).toString('hex')
  const name = `${base}${ext}`

  const sharp = isImage(file.mimetype) ? await getSharp() : null
  if (sharp) {
    await sharp(file.buffer).toFile(path.join(dir, name))
    for (const w of media.sizes || []) {
      await sharp(file.buffer).resize({ width: w, withoutEnlargement: true }).toFile(path.join(dir, `${base}-${w}${ext}`))
    }
  } else {
    writeFileSync(path.join(dir, name), file.buffer)
  }
  return `${url}/${name}`.replace(/\/{2,}/g, '/')
}
