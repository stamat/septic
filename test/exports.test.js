// The package surface other tools compose septic through — every name
// lib/index.js promises, pinned so a refactor cannot silently drop one.
// Deliberately not covered: behaviour — each export's own suite owns that.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as septic from '../lib/index.js'

test('the package exports everything a host application composes', () => {
  const functions = [
    'createServer', 'prepareDb', 'loadConfig', 'build', 'toMarkup',
    'emitForms', 'formHtml', 'parseResources', 'parseResource', 'openDb',
    'createStore', 'resourceStore', 'hashPassword', 'verifyPassword', 'crudRouter'
  ]
  for (const name of functions) {
    assert.equal(typeof septic[name], 'function', `missing export: ${name}`)
  }
  for (const name of ['AccessError', 'NotFoundError', 'ConflictError', 'ValidationError']) {
    assert.ok(septic[name].prototype instanceof Error, `missing error export: ${name}`)
  }
})

test('a hash from the exported hashPassword verifies with the exported verifyPassword', () => {
  const stored = septic.hashPassword('correct horse')
  assert.ok(septic.verifyPassword('correct horse', stored))
  assert.ok(!septic.verifyPassword('wrong horse', stored))
})
