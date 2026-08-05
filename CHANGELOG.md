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

## [1.0.0] — one config, a backend

The first release. Everything below was built and tagged across a run of 0.x and
1.x tags that never reached a registry; those tags and their releases are gone,
and this is the version anyone installing septic gets. Nothing was removed to
make it — the collapse is bookkeeping, not a rewrite.

The bar for calling it 1.0 was the dogfood: septic had to be able to serve
[pooppress](https://github.com/stamat/pooppress)'s real schema — a CMS backend
hand-written before septic existed. It can, against pooppress's own committed
migration, which is what `test/dogfood-live.test.js` runs.

### Added

- **The `septic` block in `poops.json`.** `db`, `resources`, per-resource
  `methods` and `access`, `auth.seed`, `media`, `build`. Presence is
  instantiation, à la carte like poops — nothing mounts unless declared, and the
  config file is the one poops already reads.
- **The field DSL** (`lib/schema.js`): `string` `text` `slug` `email` `integer`
  `boolean` `datetime` `json` `file` `image` `enum(a,b,c)` `ref:<resource>`;
  flags `required`, `unique`, `ondelete=cascade|setnull|restrict`; defaults via
  `= value`, with `= now` stamping a datetime at insert and `= now!` re-stamping
  it on every update. The parsed descriptor is the single source of truth that
  both table creation and validation read.
- **Auto REST CRUD** per resource, only for the `methods` listed, gated by
  `access` — `"public"`, a role, or a list of roles, with `admin` passing
  everything. `fieldAccess` narrows a single field, so an author submitting
  `status=published` simply cannot set it.
- **Validation mapped to HTTP**: type, enum, slug, email and required failures
  are `422`; a unique collision is `409`; a missing foreign key is `422`.
- **Auth**: scrypt password hashing and a stateless HMAC-signed session cookie,
  `POST /api/_auth/login` and `/logout`. A `users` resource in config extends
  septic's own users table rather than colliding with it.
- **List querying**: `?limit=&offset=` (capped at 200), `?sort=&order=`,
  `?<col>=value` equality filters, and `?expand=<refField>` to inline a `ref:`
  row in place of its id. Column names are checked against the schema, so no
  query parameter reaches SQL as an identifier; unknown ones are ignored.
- **Schema shapes a real CMS needed**: composite `unique`, its COALESCE form
  (`{ columns, coalesce }`) so a nullable column treats NULL as a sentinel,
  secondary `indexes`, `json` columns hydrated on read, and additive `ALTER` for
  fields added to an existing config.
- **Media**: `file` and `image` fields take multipart uploads, stored under
  `media.dir` and served at `media.url`, with a resized variant per `media.sizes`
  width via `sharp` — lazily loaded and optional. An `image` field stores
  `{ path, name, mime, size, width, height, variants[] }`.
- **The poops bridge**: `septic build` turns rows into `{into}/{slug}.md` (YAML
  front matter plus the body field), regenerated clean so a deleted row leaves no
  orphan, then runs poops over the same `poops.json`. `where` filters which rows
  are emitted, so a blog's drafts stay out of the static site while the API keeps
  serving them. poops is an optional peer: markup is always written, compiling is
  skipped with a note when poops is absent.
- **Forms that work**, generated from the same field DSL that made the table and
  wired to the resource's own endpoint. The routes content-negotiate: HTMX gets
  `HX-Redirect` or the form re-rendered with errors and values kept, a browser
  gets 303 Post/Redirect/Get, an API client gets JSON — all `422` on failure.
  `GET /api/:resource/:id` as a writer wanting HTML returns a prefilled edit
  form, submitting via `hx-put` or a hidden `_method=PUT`, and applies no
  defaults so server-owned fields survive an edit.
- **Progressive validation**: native HTML5 attributes are emitted, so validation
  fires with no JavaScript. The optional `assets/septic-forms.js` reads the
  browser's own `ValidityState` into styled inline messages — no rules
  duplicated, and `validate.js` remains the authority.
- **A public API** (`lib/index.js`): `createServer`, `prepareDb`, `loadConfig`,
  `build`, `toMarkup`, `emitForms`, `formHtml`, `parseResource(s)`, `openDb` —
  the surface [laxative](https://github.com/stamat/laxative) composes, so no tool
  has to reach into `lib/*` paths.
- **The dogfood tests**: `test/dogfood.test.js` builds pooppress's six-table
  schema from config and asserts columns, indexes, FK actions and forms;
  `test/dogfood-live.test.js` stands up pooppress's committed migration verbatim
  and serves CRUD, field access, filtering and expand over it without altering
  it. `docs/DOGFOOD.md` maps the two.
- **The documentation site** at [stamat.info/septic](https://stamat.info/septic/),
  built with poops and poops-docs-theme, with a reference, two how-tos and the
  dogfood write-up.

### Known limits

- **Not on npm.** Install is `npm i stamat/septic` from git; publishing waits on
  an npm trusted publisher, and `publish.yml` stays gated on the `NPM_PUBLISH`
  repository variable until then.
- **No migrations.** Schema creation is declarative `CREATE TABLE IF NOT EXISTS`
  plus additive `ALTER` for new fields; changing an existing column's type or
  constraints on a populated table is not handled.
- **No realtime, no admin UI, no plugin system** — see
  [CONTRIBUTING.md](CONTRIBUTING.md) for why those are refusals rather than
  roadmap.
