import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadConfig } from '../lib/config.js'

// Covers: what loadConfig says about a `septic` block whose keys the schema does
// not describe. A misspelt key is read by nothing — the resource loses the flag,
// the build loses the layout, and the only sign is output that never appears —
// so it is named at load time, against the schema this package ships.
//
// Deliberately not covered: types and required keys. The check reads key names
// only, so `"db": 7` is not its finding; the schema test next door is where the
// schema itself is held to the parser.

const write = (config) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'septic-config-'))
  writeFileSync(path.join(dir, 'poops.json'), JSON.stringify(config))
  return dir
}

// loadConfig warns as a side effect, which is the whole behaviour under test.
const warningsFrom = (config) => {
  const dir = write(config)
  const said = []
  const original = console.warn
  console.warn = (message) => said.push(message)
  try {
    loadConfig(dir)
  } finally {
    console.warn = original
    rmSync(dir, { recursive: true, force: true })
  }
  return said
}

const VALID = { septic: { db: 'data/app.db', resources: { posts: { fields: { title: 'string required' } } } } }

test('says nothing about a block that keeps to the schema', () => {
  assert.deepEqual(warningsFrom(VALID), [])
})

test('names a misspelt key in the block itself, and what belonged there', () => {
  const said = warningsFrom({ septic: { ...VALID.septic, resorces: {} } })
  assert.equal(said.length, 1)
  assert.match(said[0], /unknown key "resorces" in septic/)
  assert.match(said[0], /db, auth, media, resources, build/)
})

test('reaches a resource, where a misspelt key costs the flag it was meant to set', () => {
  const said = warningsFrom({ septic: { resources: { posts: { fields: {}, methdos: ['GET'] } } } })
  assert.equal(said.length, 1, 'one typo, one warning')
  assert.match(said[0], /unknown key "methdos" in septic\.resources\.posts/)
})

test('reaches into the build bridge, the furthest a key is read from', () => {
  const said = warningsFrom({ septic: { resources: {}, build: { resources: { posts: { into: 'p', layuot: 'x' } } } } })
  assert.match(said[0], /unknown key "layuot" in septic\.build\.resources\.posts/)
})

test('leaves the resource names alone, since naming them is the whole point', () => {
  assert.deepEqual(warningsFrom({ septic: { resources: { anythingIWant: { fields: {} } } } }), [])
})

test('leaves the rest of poops.json to poops, sharing the file being the whole pitch', () => {
  const shared = { ...VALID, styles: [{ in: 'src/a.scss', out: 'dist/a.css' }], stlyes: [] }
  assert.deepEqual(warningsFrom(shared), [])
})

test('the notify block survives loading — a config key the server reads must reach the server', () => {
  const dir = write({ septic: { db: 'x.db', resources: {}, notify: { url: 'https://hook.example/x' } } })
  const loaded = loadConfig(dir)
  assert.equal(loaded.notify?.url, 'https://hook.example/x', 'loadConfig dropped the notify block on the floor')
})
