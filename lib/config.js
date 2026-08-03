import { readFileSync } from 'node:fs'
import path from 'node:path'

// The whole pitch: config lives in poops.json under a `septic` block — one file
// drives frontend (poops) and backend (septic). Paths resolve relative to it.
// ponytail: poops.json only for now; a separate septic.json only if someone
// actually needs to split them.
export function loadConfig(root = process.cwd(), file = 'poops.json') {
  const configPath = path.isAbsolute(file) ? file : path.join(root, file)
  const raw = JSON.parse(readFileSync(configPath, 'utf8'))
  if (!raw.septic) throw new Error(`septic: no "septic" block in ${configPath}`)
  const s = raw.septic
  const baseDir = path.dirname(configPath)
  return {
    root: baseDir,
    dbPath: path.resolve(baseDir, s.db || 'data/septic.db'),
    resources: s.resources || {},
    auth: s.auth || {},
    media: s.media || null,   // v0.2
    build: s.build || null    // v0.3 — the poops bridge
  }
}
