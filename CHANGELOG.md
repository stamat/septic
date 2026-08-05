# Changelog

All notable changes to septic are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Contributing an entry

Write your change under `## [Unreleased]`, grouped under `### Added`,
`### Changed`, `### Fixed`, `### Deprecated`, `### Removed` or `### Security`.
Write it for the person upgrading, not the person who wrote the code: a renamed
option, a different default, an error that is now thrown, output that moved.

## [Unreleased]

## [1.2.0] — a public API

### Added

- A barrel entry (`lib/index.js`) exports the composable surface —
  `createServer`, `prepareDb`, `loadConfig`, `build`, `emitForms`, `formHtml`,
  `parseResource(s)`, `openDb` — so other tools (laxative) build on septic
  without reaching into `lib/*` paths. `main`/`exports` now point at it.

## [1.1.0] — the dogfood, for real

Ran septic against pooppress's actual committed migration and closed the two
semantic gaps the schema-only proof had glossed.

### Added

- **Live dogfood** (`test/dogfood-live.test.js` + `test/fixtures/pooppress-init.sql`):
  septic stands up pooppress's real migration and serves CRUD, field access,
  filtering and expand over it — honouring pooppress's own COALESCE slug index
  and NOT NULL DEFAULT columns, without altering the schema.
- **COALESCE composite unique.** `unique: [{ columns:["collection","slug"], coalesce:{collection:0} }]`
  so a nullable column treats NULL as a sentinel — two null-collection pages
  collide, matching pooppress's `idx_posts_slug`. (Plain `[["a","b"]]` still works.)
- Media metadata: an `image` field now stores `{ path, name, mime, size, width, height, variants[] }`.

### Changed

- **`image` fields now return a metadata object, not a bare path string.** Read
  `row.image.path` for the URL. (`file` fields are unchanged — still a path.)
- Inserts **omit** missing optional fields instead of writing `NULL`, so a
  column's own `DEFAULT` applies — required for serving tables septic didn't
  create. No change for septic-created tables (their columns are nullable).

## [1.0.0] — pooppress fits

The gaps the pooppress dogfood surfaced are closed. pooppress's full schema — all
six tables — now expresses as a septic config: `docs/DOGFOOD.md` shows the
mapping and `test/dogfood.test.js` runs it. That was the bar for 1.0, so this is
1.0. The config surface (field DSL, resource keys) is now stable.

### Added

- **Media.** `file` and `image` field types. Multipart uploads are stored under
  `media.dir` and served at `media.url`; images get a resized variant per
  `media.sizes` width (via `sharp`, loaded lazily and optional). Forms render a
  file input and switch to `multipart/form-data`.
- **`json` type.** Stored as TEXT, validated, and hydrated back to an object on
  read.
- **Touch fields.** `= now!` re-stamps a datetime on every write (an
  `updated_at`), where `= now` stamps only at insert.
- **FK on-delete.** `ref:x ondelete=cascade|setnull|restrict`.
- **Composite / secondary indexes.** Resource-level `unique: [["a","b"]]`
  (slug-unique-per-collection) and `indexes: [["status"]]`.
- **Extensible auth users.** A `users` resource in config adds columns to
  septic's built-in users table (ALTER), so a project can carry `display_name`,
  `avatar_url`, etc.
- **Field-level write access.** `fieldAccess: { status: { write: ["editor"] } }`
  — an author submitting `status=published` simply can't set it.
- **Array access rules already**, plus additive `ALTER` on config change (a
  poor-man's forward migration for added fields).

### Changed

- `access.read`/`write` and `fieldAccess.*.write` accept a role, a list of roles,
  or `"public"`; `admin` passes everything.

## [0.2.0] — the poops bridge, working forms, and queries

The same DB that serves the live API now feeds the poops static build, generates
the forms that write back to it, and answers filtered/sorted/expanded reads. One
`poops.json`, one dataset — a live API, a static site, and the forms in between.
This is the thing no other backend does.

### Added

- `septic.build` config block: per-resource `{ into, slug, body, layout }`
  mapping (where to emit markup inside the poops source tree, and how to map
  fields).
- `septic build` CLI: DB rows → `{into}/{slug}.md` (YAML front matter + body),
  regenerated clean each run, then runs poops if it's installed.
- `lib/build.js` — `build(config, db, { compile })` and `toMarkup(row, spec)`.
  poops is an **optional peer**: markup emission never depends on it; compiling
  is skipped with a note when poops isn't present.
- `build.forms` config: generate an HTML `<form>` per resource from the same
  field DSL — field types map to inputs (`slug`→pattern, `enum`→select,
  `ref:`→select from the DB, `email`→`type=email`, …), wired to the resource's
  `/api` endpoint. Optional per-field `hints` (`label`, `widget`, `help`,
  `maxlength`, `min`/`max`).
- **The forms work.** The create route content-negotiates: HTMX/browser submits
  get HTML back (the form re-rendered with errors + submitted values, or a
  redirect on success via `HX-Redirect`/303 PRG); API clients still get JSON.
- New field type `email` (server-validated + native `type=email`).
- `assets/septic-forms.js` — optional, dependency-free progressive enhancement:
  turns native `ValidityState` into styled inline messages in the same
  `.septic-error` slot the server uses, re-enhancing after HTMX swaps. No rules
  duplicated — everything is read from the browser's native validation. Without
  it, native HTML5 validation still fires.
- **Edit forms.** `GET /api/:resource/:id` from a writer wanting HTML returns
  the row as a prefilled edit form (PUT). Submit via HTMX `hx-put`, or no-JS via
  POST + a hidden `_method=PUT` the server honours. Editing applies no defaults,
  so a `datetime = now` (and any server-owned field) survives an edit; clearing
  a required field still errors.
- **List querying.** `?sort=<col>&order=asc|desc` and `?<col>=value` equality
  filters, over the existing `?limit=/?offset=`. Column names are checked against
  the schema (no injection); unknown params are ignored, not errors.
- **Relation expand.** `?expand=<refField>[,...]` inlines a `ref:` field's
  referenced row in place of its id, on list and single-row reads.
- **Array access rules.** `access.read`/`write` accept a list of roles
  (`["editor", "admin"]`), not just one; `admin` still passes everything.

## [0.1.0] — the spine

First cut: `poops.json` config → SQLite schema → REST CRUD → validation → auth.
Node-native, no dragged binaries.

### Added

- `septic` block in `poops.json`: `db` path, `resources`, per-resource
  `methods` and `access`, and `auth.seed`. Presence = instantiation, à la carte
  like poops — nothing mounts unless declared.
- Field DSL (`lib/schema.js`): `string`, `text`, `slug`, `integer`, `boolean`,
  `datetime`, `enum(a,b,c)`, `ref:<resource>`; flags `required` / `unique`;
  `= default` (`datetime = now` fills at insert). The parsed descriptor is the
  single source of truth for both table creation and validation.
- Auto REST CRUD per resource, only for the listed `methods`; list pagination
  via `?limit=` / `?offset=`.
- Validation → HTTP: type/enum/slug/required failures `422`, unique `409`,
  missing FK `422`.
- Auth: scrypt password hashing + HMAC-signed session cookie; access rules are
  `"public"` or a role name, `admin` passes everything.
- `septic serve` CLI and `createServer(config)` for embedding and tests.
- One runnable CRUD-roundtrip check (`test/crud.test.js`, `node --test`).
