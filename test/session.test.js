import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createServer } from '../lib/server.js'

// The session middleware runs on every request, so a hostile Cookie header must
// read as "no session", never as a 500. Covered: malformed percent-encoding,
// multibyte macs, garbage bodies, and that a real session still works after all
// that. Not covered: expiry (a clock test for another day) and cookie flags.
const DB = new URL('./tmp-session.db', import.meta.url).pathname
const wipe = () => ['', '-wal', '-shm'].forEach((s) => rmSync(DB + s, { force: true }))

const config = {
  dbPath: DB,
  auth: { seed: { email: 'a@t.dev', password: 'secret123', role: 'admin' } },
  resources: {
    posts: { methods: ['GET'], access: { read: 'public', write: 'admin' }, fields: { title: 'string' } }
  }
}

let base, server, db
const at = (p) => `${base}${p}`

before(async() => {
  wipe()
  const built = createServer(config)
  db = built.db
  await new Promise((resolve) => { server = built.app.listen(0, resolve) })
  base = `http://localhost:${server.address().port}`
})
after(() => { server?.close(); db?.close(); wipe() })

const withCookie = (cookie) => fetch(at('/api/posts'), { headers: { cookie } })

test('a cookie with malformed percent-encoding does not 500 the request', async() => {
  assert.equal((await withCookie('septic_session=%zz')).status, 200)
})

test('an unrelated malformed cookie on the domain does not 500 the request', async() => {
  assert.equal((await withCookie('tracking=%E0%A4%A; septic_session=whatever')).status, 200)
})

test('a mac with multibyte characters cannot crash the comparison', async() => {
  // String length matches the hex digest (64), byte length does not —
  // timingSafeEqual would throw on the length mismatch.
  const mac = 'é' + 'a'.repeat(63)
  assert.equal((await withCookie(`septic_session=abc.${mac}`)).status, 200)
})

test('a token with a valid shape but a garbage body reads as anonymous', async() => {
  assert.equal((await withCookie('septic_session=notbase64json.deadbeef')).status, 200)
})

test('after all that, a real login still authenticates', async() => {
  const login = await fetch(at('/api/_auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@t.dev', password: 'secret123' })
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.getSetCookie()[0].split(';')[0]
  const res = await fetch(at('/api/posts'), { headers: { cookie, accept: 'application/json' } })
  assert.equal(res.status, 200)
})
