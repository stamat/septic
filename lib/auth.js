import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto'
import { Router } from 'express'
import { esc, wantsHtml } from './forms.js'

// Password hashing lifted from pooppress/server/auth.js — pinned scrypt params,
// stored self-describing so they can be raised later without a flag day.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, saltlen: 16, maxmem: 256 * 1024 * 1024 }
const COOKIE = 'septic_session'
const SESSION_MS = 14 * 86400_000

// ponytail: secret from env, else random per boot (dev sessions drop on
// restart). Set SEPTIC_SECRET in prod. Per-account locks / sessions table only
// if a use case needs revocation — a signed self-describing cookie is enough now.
const SECRET = process.env.SEPTIC_SECRET || randomBytes(32).toString('hex')

export function hashPassword(password, salt = randomBytes(SCRYPT.saltlen)) {
  const key = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`
}

export function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, key] = String(stored).split('$')
  if (scheme !== 'scrypt') return false
  const expected = Buffer.from(key, 'hex')
  const actual = scryptSync(password, Buffer.from(salt, 'hex'), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem })
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

const sign = (body) => createHmac('sha256', SECRET).update(body).digest('hex')

function makeToken(user) {
  const body = Buffer.from(JSON.stringify({ uid: user.id, role: user.role, exp: Date.now() + SESSION_MS })).toString('base64url')
  return `${body}.${sign(body)}`
}

// A cookie is hostile input: a multibyte mac makes timingSafeEqual throw on
// buffer length, a forged body can be non-JSON. Any of that is "no session",
// never a thrown error — this runs on every request.
function readToken(token) {
  if (!token) return null
  try {
    const [body, mac] = token.split('.')
    if (!body || !mac) return null
    const expected = sign(body)
    const a = Buffer.from(mac)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const data = JSON.parse(Buffer.from(body, 'base64url').toString())
    return data.exp && data.exp >= Date.now() ? data : null
  } catch {
    return null
  }
}

// decodeURIComponent throws on malformed percent-encoding ("%zz") — and any
// cookie on the domain hits this parser, not just septic's. Keep such a value
// raw instead of taking every route down with a 500.
const softDecode = (s) => { try { return decodeURIComponent(s) } catch { return s } }
const parseCookies = (header = '') =>
  Object.fromEntries(header.split(';').map((c) => c.trim().split('=').map(softDecode)).filter((p) => p[0]))

// Populate req.user from the session cookie. Mount before the resource routers.
export function session() {
  return (req, _res, next) => {
    const data = readToken(parseCookies(req.headers.cookie)[COOKIE])
    req.user = data ? { id: data.uid, role: data.role } : null
    next()
  }
}

// Access rule: "public" | "<role>" | ["<role>", ...]. admin passes everything.
export function allows(user, rule) {
  const rules = Array.isArray(rule) ? rule : [rule]
  if (rules.includes('public')) return true
  if (!user) return false
  return user.role === 'admin' || rules.includes(user.role)
}

export function ensureUsers(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS "users" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL UNIQUE,
    "role" TEXT NOT NULL DEFAULT 'user',
    "password_hash" TEXT NOT NULL
  )`)
}

// Dev convenience: seed the first admin from config, only when no users exist.
export function seedAdmin(db, seed) {
  if (!seed?.email || !seed?.password) return
  if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) return
  db.prepare('INSERT INTO users (email, role, password_hash) VALUES (?, ?, ?)')
    .run(seed.email, seed.role || 'admin', hashPassword(seed.password))
}

// Where a login sends the browser afterwards. Only a same-origin relative
// path survives: an absolute URL or a scheme-relative `//host` here is an open
// redirect wearing a next= parameter.
const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) ? next : '/'

// The login page. No signup beside it on purpose: users come from the seed or
// the users table, and public registration is an application decision — roles,
// verification, abuse — not a default a backend should ship turned on.
export function loginHtml({ error = null, next = '/' } = {}) {
  const err = error ? `  <p class="septic-error" role="alert">${esc(error)}</p>\n` : ''
  return `<form class="septic-form septic-login" method="post" action="/api/_auth/login" accept-charset="utf-8">
${err}  <input type="hidden" name="next" value="${esc(safeNext(next))}">
<p class="field">
  <label for="login-email">Email</label>
  <input id="login-email" name="email" type="email" required autocomplete="email">
</p>
<p class="field">
  <label for="login-password">Password</label>
  <input id="login-password" name="password" type="password" required autocomplete="current-password">
</p>
  <button type="submit">Log in</button>
</form>
`
}

export function authRouter(db) {
  const r = Router()
  // The page for the POST below it. JSON clients keep the 404 this route
  // always was to them — the form is for a person, the API needs no page.
  r.get('/login', (req, res) => {
    if (wantsHtml(req)) return res.send(loginHtml({ next: req.query.next }))
    res.status(404).json({ error: 'not found' })
  })
  r.post('/login', (req, res) => {
    const { email, password } = req.body || {}
    const html = wantsHtml(req)
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    if (!user || !verifyPassword(password || '', user.password_hash)) {
      if (html) return res.status(401).send(loginHtml({ error: 'Invalid email or password.', next: req.body?.next }))
      return res.status(401).json({ error: 'invalid credentials' })
    }
    res.setHeader('Set-Cookie', `${COOKIE}=${makeToken(user)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`)
    if (html) return res.redirect(303, safeNext(req.body?.next))
    res.json({ id: user.id, email: user.email, role: user.role })
  })
  r.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`)
    if (wantsHtml(req)) return res.redirect(303, '/')
    res.json({ ok: true })
  })
  return r
}
