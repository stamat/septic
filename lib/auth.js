import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto'
import { Router } from 'express'

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

function readToken(token) {
  if (!token) return null
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const expected = sign(body)
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  const data = JSON.parse(Buffer.from(body, 'base64url').toString())
  return data.exp && data.exp >= Date.now() ? data : null
}

const parseCookies = (header = '') =>
  Object.fromEntries(header.split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((p) => p[0]))

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

export function authRouter(db) {
  const r = Router()
  r.post('/login', (req, res) => {
    const { email, password } = req.body || {}
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    if (!user || !verifyPassword(password || '', user.password_hash)) {
      return res.status(401).json({ error: 'invalid credentials' })
    }
    res.setHeader('Set-Cookie', `${COOKIE}=${makeToken(user)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`)
    res.json({ id: user.id, email: user.email, role: user.role })
  })
  r.post('/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`)
    res.json({ ok: true })
  })
  return r
}
