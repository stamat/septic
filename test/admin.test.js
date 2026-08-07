import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import http from 'node:http'
import { createServer } from '../lib/server.js'

// The negotiated admin and the door into it: a writer's browser GET of the
// list route is a table, an anonymous browser on a denied route lands on the
// login page and comes back, and a create pings the notify webhook. Covered
// over real HTTP, like crud.test.js. Deliberately not covered: the HTMX
// variants of these pages (the negotiation itself is pinned by crud tests)
// and webhook retries — there are none, fire-and-forget is the contract.
const DB = new URL('./tmp-admin.db', import.meta.url).pathname
const wipe = () => ['', '-wal', '-shm'].forEach((s) => rmSync(DB + s, { force: true }))

// The webhook target: a real listener capturing every JSON body it is sent.
const hooked = []
let hookServer, hookPort

const config = () => ({
  dbPath: DB,
  auth: { seed: { email: 'admin@test.dev', password: 'secret123', role: 'admin' } },
  notify: { url: `http://localhost:${hookPort}/hook`, events: ['create'] },
  resources: {
    posts: {
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      access: { read: 'admin', write: 'admin' },
      fields: { title: 'string required', created: 'datetime = now' }
    }
  },
  build: { forms: { posts: { into: 'unused', success: '/', submitLabel: 'Save' } } }
})

let base, server, db
const url = (p) => `${base}${p}`
const HTML = { accept: 'text/html' }

before(async() => {
  wipe()
  await new Promise((resolve) => {
    hookServer = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => { hooked.push(JSON.parse(body)); res.end('ok') })
    }).listen(0, () => { hookPort = hookServer.address().port; resolve() })
  })
  const built = createServer(config())
  db = built.db
  await new Promise((resolve) => { server = built.app.listen(0, resolve) })
  base = `http://localhost:${server.address().port}`
})

after(() => { server?.close(); hookServer?.close(); db?.close(); wipe() })

async function login() {
  const res = await fetch(url('/api/_auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.dev', password: 'secret123' })
  })
  assert.equal(res.status, 200)
  return res.headers.getSetCookie()[0].split(';')[0]
}

test('an anonymous browser on a denied route lands on the login page, carrying where it was going', async() => {
  const res = await fetch(url('/api/posts'), { headers: HTML, redirect: 'manual' })
  assert.equal(res.status, 303)
  const to = res.headers.get('location')
  assert.match(to, /^\/api\/_auth\/login\?next=/)
  const page = await fetch(url(to), { headers: HTML })
  assert.equal(page.status, 200)
  assert.match(await page.text(), /septic-login/, 'the redirect target is not the login form')
})

test('an anonymous JSON client on the same route keeps its 401, no redirect', async() => {
  const res = await fetch(url('/api/posts'), { redirect: 'manual' })
  assert.equal(res.status, 401)
})

test('a browser login sets the cookie and follows next; an off-origin next is not followed', async() => {
  const form = (next) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...HTML },
    body: `email=admin%40test.dev&password=secret123&next=${encodeURIComponent(next)}`,
    redirect: 'manual'
  })
  let res = await fetch(url('/api/_auth/login'), form('/api/posts'))
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/api/posts')
  assert.match(res.headers.get('set-cookie'), /septic_session=/)

  res = await fetch(url('/api/_auth/login'), form('https://evil.example/phish'))
  assert.equal(res.headers.get('location'), '/', 'an absolute next was followed — open redirect')
  res = await fetch(url('/api/_auth/login'), form('//evil.example/phish'))
  assert.equal(res.headers.get('location'), '/', 'a scheme-relative next was followed — open redirect')
})

test('a wrong password re-renders the login form with the error, still a 401', async() => {
  const res = await fetch(url('/api/_auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...HTML },
    body: 'email=admin%40test.dev&password=wrong'
  })
  assert.equal(res.status, 401)
  assert.match(await res.text(), /Invalid email or password/)
})

test("a writer's browser GET of the list is a table of rows linking their edit forms; JSON clients keep the array", async() => {
  const cookie = await login()
  const h = { 'content-type': 'application/json', cookie }
  const a = await (await fetch(url('/api/posts'), { method: 'POST', headers: h, body: JSON.stringify({ title: 'First <post>' }) })).json()

  const page = await fetch(url('/api/posts'), { headers: { ...HTML, cookie } })
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /<table>/)
  assert.match(html, new RegExp(`href="/api/posts/${a.id}"`), 'a row does not link its edit form')
  assert.match(html, /First &lt;post&gt;/, 'a title with markup was not escaped')
  assert.match(html, /septic-form/, 'the create form is missing from the admin page')

  const json = await (await fetch(url('/api/posts'), { headers: { cookie } })).json()
  assert.ok(Array.isArray(json), 'a JSON client stopped getting the array')
})

test('the admin list paginates: a full page links older, a later page links newer', async() => {
  const cookie = await login()
  const h = { 'content-type': 'application/json', cookie }
  for (let i = 0; i < 3; i++) await fetch(url('/api/posts'), { method: 'POST', headers: h, body: JSON.stringify({ title: `p${i}` }) })
  const first = await (await fetch(url('/api/posts?limit=2'), { headers: { ...HTML, cookie } })).text()
  assert.match(first, /offset=2/, 'a full first page offers no way to older rows')
  assert.doesNotMatch(first, /newer/, 'a first page offers a way back it does not have')
  const second = await (await fetch(url('/api/posts?limit=2&offset=2'), { headers: { ...HTML, cookie } })).text()
  assert.match(second, /newer/, 'a later page offers no way back')
})

test('a create notifies the webhook with the event, the resource and the row', async() => {
  const cookie = await login()
  const seen = hooked.length
  await fetch(url('/api/posts'), { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ title: 'Hooked' }) })
  // Fire-and-forget: give the loopback POST a moment to land.
  await new Promise((r) => setTimeout(r, 300))
  const hit = hooked.slice(seen).find((h) => h.row?.title === 'Hooked')
  assert.ok(hit, 'the webhook never heard about the create')
  assert.equal(hit.event, 'create')
  assert.equal(hit.resource, 'posts')
})

test('an unanswered webhook never fails the write it reports', async() => {
  // Point notify at a port that answers nothing.
  const deadConfig = config()
  deadConfig.dbPath = DB + '.dead'
  deadConfig.notify = { url: 'http://localhost:9', timeout: 200 }
  const built = createServer(deadConfig)
  const srv = await new Promise((resolve) => { const s = built.app.listen(0, () => resolve(s)) })
  try {
    const res = await fetch(`http://localhost:${srv.address().port}/api/_auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.dev', password: 'secret123' })
    })
    const cookie = res.headers.getSetCookie()[0].split(';')[0]
    const create = await fetch(`http://localhost:${srv.address().port}/api/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Still lands' })
    })
    assert.equal(create.status, 201, 'a dead webhook took the write down with it')
  } finally {
    srv.close(); built.db.close()
    ;['', '-wal', '-shm'].forEach((s) => rmSync(DB + '.dead' + s, { force: true }))
  }
})
