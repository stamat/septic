# septic — agent notes

Config-driven backend for the poops ecosystem: one `poops.json` → SQLite + REST
CRUD + auth. Read [CONTRIBUTING.md](CONTRIBUTING.md) first — it defines what
belongs in this project and what a pull request needs.

## Commands

```bash
script/bootstrap # install what the project needs, from a fresh clone
script/server    # run it locally against example/poops.json
script/test      # run the tests
script/lint      # run the linter (neostandard; the authority, CI runs it)
```

## Layout

- `lib/` — source of truth. `schema.js` holds the **field DSL** parser; its
  output descriptor is read by *both* the DB layer (`db.js`, `crud.js`) and the
  validator (`validate.js`) — change the grammar in one place, never diverge
  the two.
- `bin/septic.js` — CLI.
- `test/` — `node:test`; `test/crud.test.js` is the roundtrip spec.
- No build step: the library ships as source.

## Principles

- **Test-driven.** The test is the spec; write it first. A failing test means
  the code is wrong — never weaken, skip, or delete a test to make it pass.
- **YAGNI.** Build only what the task needs. septic is deliberately minimal —
  its moat is the poops tie-in, not feature parity with PocketBase/Supabase.
- **Native / stdlib first.** In order: already in this repo → the platform →
  the standard library → new code. A new dependency is a last resort.
- **Root cause over symptom.** Fix where all callers route through.
- **Delete dead code.** Git remembers.

## Boundaries

- **Always:** run `script/lint` and `script/test` before calling work done;
  pair every fix or feature with a test; add a changelog entry under
  `## [Unreleased]`.
- **Ask first:** changing the `septic` config or field-DSL shape; adding a
  dependency; changing a public route.
- **Never:** weaken, skip, or delete a test to make it pass; bump the version
  or publish — a `v*` tag does that.

## Non-obvious rules

- The field-DSL descriptor is one source of truth two layers read. If column
  creation and validation ever disagree about a field, that is the bug.
- scrypt needs `maxmem: 256 * 1024 * 1024` — N=32768×r=8 blows the 32 MB
  default and throws `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`. See `lib/auth.js`.
- Schema is declarative `CREATE TABLE IF NOT EXISTS` (dev). No migrations yet,
  so changing a field on an existing table won't apply until the migration
  story lands (before v1.0).
- The session secret is random-per-boot unless `SEPTIC_SECRET` is set — dev
  sessions drop on restart and can't be shared across workers.
