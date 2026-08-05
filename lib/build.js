import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { dump as dumpYaml } from 'js-yaml'
import { emitForms } from './forms.js'

const run = promisify(execFile)

// The moat: the same DB that serves the live API also feeds the poops static
// build. `build` writes each row as a markup file (YAML front matter + body)
// into the poops source tree, then runs poops over the one shared poops.json.

// Resolve the poops CLI *if installed*. poops is an optional peer: septic always
// emits markup; compiling needs poops present.
async function resolvePoops() {
  try {
    return new URL(await import.meta.resolve('poops/poops.js')).pathname
  } catch {
    return null
  }
}

// One row → one markup document. Every field except the body becomes front
// matter; the body field becomes the document body. `layout` is added if the
// resource's build spec names one. Nulls are dropped so absent values don't
// litter the front matter.
export function toMarkup(row, spec = {}) {
  const bodyField = spec.body || 'body'
  const front = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === bodyField || v === null) continue
    front[k] = v
  }
  if (spec.layout) front.layout = spec.layout
  const fm = dumpYaml(front).trimEnd()
  return `---\n${fm}\n---\n\n${row[bodyField] ?? ''}\n`
}

// DB rows → markup files, then (optionally) run poops. `compile: false` stops
// after emitting markup — that's the part septic owns and the part the tests
// pin; the poops invocation is a thin, isolated child process.
export async function build(config, db, { compile = true } = {}) {
  if (!config.build) throw new Error('septic: no "build" block in config')
  const root = config.root || process.cwd()
  const written = {}

  for (const [name, spec] of Object.entries(config.build.resources || {})) {
    const dir = path.resolve(root, spec.into)
    rmSync(dir, { recursive: true, force: true }) // regenerate clean: deleted rows leave no orphan files
    mkdirSync(dir, { recursive: true })
    const slugField = spec.slug || 'slug'
    // Optional equality filter, so a blog can emit only published posts and keep
    // drafts out of the static site. Column names come from config, not input.
    const where = spec.where && Object.keys(spec.where).length
      ? ' WHERE ' + Object.keys(spec.where).map((k) => `"${k}" = ?`).join(' AND ')
      : ''
    const rows = db.prepare(`SELECT * FROM "${name}"${where}`).all(...(spec.where ? Object.values(spec.where) : []))
    for (const row of rows) {
      const slug = row[slugField] ?? String(row.id)
      writeFileSync(path.join(dir, `${slug}.md`), toMarkup(row, spec))
    }
    written[name] = rows.length
  }

  const forms = emitForms(config, db) // static <form> partials, before poops runs

  let compiled = false
  if (compile) {
    const bin = await resolvePoops()
    if (bin) {
      await run(process.execPath, [bin, '--build', '-q', '-c', 'poops.json'], { cwd: root })
        .catch((err) => { throw new Error(`poops build failed:\n${err.stderr || err.stdout || err.message}`) })
      compiled = true
    }
  }
  return { written, forms: Object.keys(forms), compiled }
}
