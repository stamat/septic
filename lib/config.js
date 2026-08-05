import { readFileSync } from 'node:fs'
import path from 'node:path'
import { unknownKeys } from 'unknown-keys'

// A key septic does not read is read by nothing: the resource loses the flag,
// the build loses the layout, and the only sign is output that never appears.
// The schema this package ships says which keys each block owns, so name them
// here — the one place every entry point routes through.
//
// The whole poops.json goes in, not just the block: the schema describes only
// `septic`, so poops' own keys pass untouched and a companion's block stays its
// own business. Key names only — a wrong type reaches the code that reads it and
// fails there. A schema that cannot be read leaves the config to load unadvised
// rather than taking the command down over a warning.
function warnAboutUnknownKeys(raw) {
  let schema = null
  try {
    schema = JSON.parse(readFileSync(new URL('../schema/septic.schema.json', import.meta.url), 'utf8'))
  } catch {
    return
  }
  for (const { path: at, key, valid } of unknownKeys(raw, schema)) {
    console.warn(`💩 septic: unknown key "${key}" in ${at} — ignored. Valid: ${valid.join(', ')}`)
  }
}

// The whole pitch: config lives in poops.json under a `septic` block — one file
// drives frontend (poops) and backend (septic). Paths resolve relative to it.
// ponytail: poops.json only for now; a separate septic.json only if someone
// actually needs to split them.
export function loadConfig(root = process.cwd(), file = 'poops.json') {
  const configPath = path.isAbsolute(file) ? file : path.join(root, file)
  const raw = JSON.parse(readFileSync(configPath, 'utf8'))
  if (!raw.septic) throw new Error(`septic: no "septic" block in ${configPath}`)
  warnAboutUnknownKeys(raw)
  const s = raw.septic
  const baseDir = path.dirname(configPath)
  return {
    root: baseDir,
    dbPath: path.resolve(baseDir, s.db || 'data/septic.db'),
    resources: s.resources || {},
    auth: s.auth || {},
    media: s.media || null,
    build: s.build || null // the poops bridge — both markup emission and form emission read it
  }
}
