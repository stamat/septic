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
script/publish   # cut a release: version, changelog, commit, tag, push
node bin/septic.js build   # DB rows → poops markup → static site (the bridge)
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
- Schema is declarative `CREATE TABLE IF NOT EXISTS` plus additive `ALTER` for
  fields added to the config. Changing an existing column's type or constraints
  on a populated table is **not** handled — 1.0 shipped without a migration
  story, and CHANGELOG.md names it as a known limit.
- The session secret is random-per-boot unless `SEPTIC_SECRET` is set — dev
  sessions drop on restart and can't be shared across workers.
- The build bridge (`lib/build.js`) runs poops as a **child process**
  (`import.meta.resolve('poops/poops.js')` → `execFile`), never by importing it
  — that keeps poops's cwd-relative path resolution and any crash isolated.
  poops is an optional peer; `build({ compile: false })` is the dependency-free
  path the tests pin.
- `formHtml` (`lib/forms.js`) is one renderer used twice: build-time (static
  partial) and request-time (the CRUD route re-renders it with errors + values
  on a bad HTML submit). That shared renderer is why the forms work — don't fork
  it into two.
- Client validation duplicates no rules: `assets/septic-forms.js` reads the
  browser's native `ValidityState` from the attributes the DSL already emits.
  `validate.js` stays the authority; the client is convenience. If you're
  tempted to add a JS rules engine, you've left the platform — don't.
- Edit vs create validation: `validateAll(..., { insert: false })` applies no
  defaults, so an edit can't reset a `datetime = now` or blank a server-owned
  field. Create keeps `insert: true`. Get this wrong and every edit silently
  stamps `created` to now.
- No-JS edits reach PUT via a `_method` override middleware in `server.js`
  (POST + hidden `_method=PUT`). HTMX sends the real verb and skips it.
- Every SQL identifier from a query param (filter column, sort column) is checked
  against the `cols` allow-list in `crud.js` before it touches SQL; values are
  always bound. Never build a column name from input without that check.
