import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import Ajv from 'ajv'
import { parseField } from '../lib/schema.js'

// The published JSON Schema is hand-written, so nothing but a test keeps it in
// step with the parser it describes. Covers: it is a valid JSON Schema, it
// accepts the configs this repo ships, and — the part that matters — its field
// DSL pattern agrees with parseField about what a field spec may say.
//
// Deliberately not covered: that the schema describes every key septic reads.
// The config surface is small enough to read, and there is no exported list to
// compare against the way parseField gives one for the DSL.

const ROOT = new URL('..', import.meta.url).pathname
const schema = JSON.parse(readFileSync(path.join(ROOT, 'schema/septic.schema.json'), 'utf8'))

// strict:false — the schema is written for editors, which accept `examples` and
// long descriptions ajv's strict mode would flag.
const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(schema)
const validateField = ajv.compile({ ...schema.definitions.field, $schema: schema.$schema })

test('the schema is itself a valid JSON Schema', () => {
  assert.ok(ajv.validateSchema(schema), ajv.errorsText(ajv.errors))
})

test('no description sits beside a $ref, where draft-07 would discard it', () => {
  const orphaned = []
  const walk = (node, at) => {
    if (Array.isArray(node)) return node.forEach((item, i) => walk(item, `${at}/${i}`))
    if (!node || typeof node !== 'object') return
    if (node.$ref && Object.keys(node).length > 1) orphaned.push(at)
    for (const [key, value] of Object.entries(node)) walk(value, `${at}/${key}`)
  }
  walk(schema, '')
  assert.deepEqual(orphaned, [], 'a $ref with siblings — wrap it in allOf')
})

test('the example config validates', () => {
  const config = JSON.parse(readFileSync(path.join(ROOT, 'example/poops.json'), 'utf8'))
  assert.ok(validate(config), ajv.errorsText(validate.errors))
})

// Every fenced ```json block in the prose that carries a `septic` key. A block
// that is not parseable JSON is prose about JSON (an ellipsis, a comment) and a
// block without the key belongs to poops or to a request body.
function configExamples(file) {
  // Normalised on read: a checkout with CRLF line endings makes a fence pattern
  // anchored to \n match nothing, and the crawler then checks zero examples
  // while still passing. CI is Ubuntu-only here, so nothing else would say so.
  const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const found = []
  for (const match of source.matchAll(/```json\n([\s\S]*?)```/g)) {
    let doc
    try { doc = JSON.parse(match[1]) } catch { continue }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue
    if (!('septic' in doc)) continue
    found.push({ file: path.relative(ROOT, file), line: source.slice(0, match.index).split('\n').length, doc })
  }
  return found
}

function markdownUnder(dir) {
  const found = []
  const walk = (at) => {
    for (const entry of readdirSync(at)) {
      const full = path.join(at, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.md')) found.push(full)
    }
  }
  walk(dir)
  return found
}

test('every config example in the README and the docs validates', () => {
  const examples = [
    path.join(ROOT, 'README.md'),
    ...markdownUnder(path.join(ROOT, 'docs/src/markup'))
  ].flatMap(configExamples)

  // A crawler that silently finds nothing would pass while checking nothing.
  assert.ok(examples.length > 0, 'no config examples found — the crawler is broken, not the docs')

  const rejected = examples
    .filter(({ doc }) => !validate(doc))
    .map(({ file, line }) => `${file}:${line} — ${ajv.errorsText(validate.errors)}`)
  assert.deepEqual(rejected, [])
})

// The field DSL is the surface a schema can most usefully police, and the only
// one with a parser to check it against.
const WELL_FORMED = [
  'string', 'text', 'slug', 'email', 'integer', 'boolean', 'datetime', 'json', 'file', 'image',
  'string required',
  'slug unique',
  'string required unique',
  'enum(draft,review,published)',
  'enum(draft,review,published) = draft',
  'ref:authors',
  'ref:authors ondelete=cascade',
  'ref:authors ondelete=setnull',
  'ref:authors required ondelete=restrict',
  'datetime = now',
  'datetime = now!',
  'string = hello world'
]

const MALFORMED = [
  ['strng required', 'a misspelt type'],
  ['string requried', 'a misspelt flag'],
  ['enum(a, b)', 'spaces inside enum values — the parser splits on whitespace and reads "b)" as a flag'],
  ['ref:authors ondelete=explode', 'an ondelete action that does not exist'],
  ['string ondelete=cascade required', 'a flag after the ondelete is fine, but this one names no ref'],
  ['datetime =now', 'the = needs a space either side'],
  ['datetime= now', 'the = needs a space either side'],
  ['', 'an empty spec']
]

test('the schema accepts every field spec the parser accepts', () => {
  for (const spec of WELL_FORMED) {
    assert.doesNotThrow(() => parseField('f', spec), `parseField rejects ${JSON.stringify(spec)} — fix the fixture, not the schema`)
    assert.ok(validateField(spec), `schema rejects ${JSON.stringify(spec)}, which parseField accepts`)
  }
})

test('the schema rejects the field specs that are typos', () => {
  for (const [spec, why] of MALFORMED) {
    assert.ok(!validateField(spec), `schema accepts ${JSON.stringify(spec)} — ${why}`)
  }
})

// Where the two deliberately disagree, so the divergence is a decision on the
// record rather than a hole someone finds later.
test('the schema is stricter than the parser about an empty default', () => {
  assert.doesNotThrow(() => parseField('f', 'string ='), 'parseField takes it, defaulting the column to an empty string')
  assert.ok(!validateField('string ='), 'the schema still flags it — nobody means to write that')
})
