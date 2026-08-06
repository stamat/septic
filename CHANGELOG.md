# Changelog

All notable changes to septic are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Contributing an entry

Write your change under `## [Unreleased]`, grouped under `### Added`,
`### Changed`, `### Fixed`, `### Deprecated`, `### Removed` or `### Security`.
Write it for the person upgrading, not the person who wrote the code: a renamed
option, a different default, an error that is now thrown, output that moved.

On `script/publish`, `script/changelog` cuts this section into a released entry
in the same commit as the version bump, and the entry becomes the body of the
GitHub release verbatim. A title written as `## [Unreleased] — the headline`
carries over into the released heading.

## [Unreleased] — the data layer, and three majors underneath

### Added

- **`createStore` — septic without the HTTP round trip.** An application with
  its own routes had no way to use septic: the package exported a server and a
  build bridge, so reaching your own database from your own request handler
  meant calling your own API over localhost. `DOGFOOD.md` already promised the
  opposite — "that code stays in pooppress and *calls into septic*" — and
  nothing exported supported it.

  ```js
  import { prepareDb, createStore } from 'septic'

  const { db, resources } = prepareDb(config)
  const store = createStore(db, resources)

  store.posts.list({ user, where: { status: 'published' } })
  store.posts.create({ title: 'Hello', slug: 'hello' }, { user })
  ```

  It enforces what the API enforces, because **the REST router is now a skin
  over exactly these calls** — `access` per call, `fieldAccess` per field, reads
  shaped to the declared fields, `expand` obeying the target's own read rule.
  There is one implementation of "what a read returns", not two that drift.

  `user` is passed per call; omitting it reads as anonymous, which is denied for
  anything not `"public"`, so a forgotten argument fails closed. `raw(id)` is the
  named exception that returns the stored row with undeclared columns — a flag on
  `get` would get passed without meaning it. Failures throw `ValidationError`
  (with an `errors` map), `AccessError`, `NotFoundError` or `ConflictError`, each
  carrying `.status`.

  Also exported: `resourceStore` for a single resource.

### Changed

- **express 5, better-sqlite3 13, js-yaml 5.** Three major dependency bumps, and
  two of them show through septic's own exports: `createServer` hands back an
  express **5** app, and `prepareDb`/`openDb` hand back a better-sqlite3 **13**
  handle. Mounting septic inside an express 4 app, or passing your own
  better-sqlite3 11 handle to `createStore`, is no longer the same pairing it
  was. The full suite passes on all three.

- **An update with nothing to update answers 400 in one wording.** Both HTTP
  paths already answered 400 there, the JSON one saying `no fields to update`
  and the HTML one `nothing to update`; there is now one message, from one place.

### Security

- **js-yaml moved off a version with a high advisory.** The dependency bump to
  `js-yaml@5.2.1` landed inside the range of
  [GHSA-pm4m-ph32-ghv5](https://github.com/advisories/GHSA-pm4m-ph32-ghv5)
  (exponential parsing time in flow collections → denial of service); the
  lockfile now resolves 5.2.3, which is outside it. septic imports only `dump`
  and never parses YAML, so nothing here was reachable — but a project running
  `npm audit` over its own tree would have seen it, and the fix was already
  inside the declared range.

### Fixed

`v2.0.0` was tagged, released on GitHub, and never reached npm. The publish
workflow gated every npm step on an `NPM_PUBLISH` repository variable that was
never set, so all four steps skipped and the run went **green** — a passing check
over a publish that did not happen. npm stayed on 1.0.0, which means everything
installing septic kept the three security fixes 2.0.0 carries.

- **`publish.yml` publishes.** The `NPM_PUBLISH` gate is gone; a `v*` tag now
  runs the npm steps unconditionally, so a publish that cannot happen fails the
  run instead of passing it. Installing dependencies goes through
  `script/bootstrap` like every other workflow here.
- **The GitHub release has one owner.** `script/publish` creates it, holding the
  entry `script/changelog` just cut; the workflow's own awk-over-CHANGELOG copy
  is gone, along with the `contents: write` permission it needed.
- **The docs said septic was not on npm.** It has been since 1.0.0 — the install
  line is `npm i septic` in the README, the docs index and the quickstart, and
  the README's status line no longer pins a version that the changelog already
  states.

## [2.0.0] - 2026-08-06

### Security

- **A malformed cookie no longer turns every route into a 500.** The session
  middleware runs on each request, and three shapes of hostile `Cookie` header
  threw inside it: malformed percent-encoding (`%zz` — in *any* cookie on the
  domain, not just septic's), a session mac with multibyte characters (byte
  length tripped `timingSafeEqual`), and a well-signed-looking token whose body
  is not JSON. All of them now read as "no session" and the request proceeds
  anonymously.

- **`?limit=-1` can no longer dump a whole table.** SQLite reads a negative
  `LIMIT` as "no limit", so the documented cap of 200 had a hole exactly one
  character wide. `limit` is now clamped to 1–200 and a negative `offset` reads
  as 0.

- **An uploaded file can no longer execute as the site.** A `file` field
  accepted any upload and kept its extension, and `express.static` maps
  extension → `Content-Type` — so an uploaded `.html` (or `.svg`, which runs
  scripts on navigation) was served same-origin as a page, a stored-XSS
  primitive for anyone with write access. Uploads now keep their extension only
  if it is on an inline-safe allow-list (common image, audio, video, `.pdf`,
  `.txt`, `.zip`); anything else is stored extension-less and served as
  `application/octet-stream` — downloaded, never rendered. The upload route
  also sends `X-Content-Type-Options: nosniff`. The original filename is still
  in the stored metadata; if you need another extension inline, it is a
  one-line addition to `INLINE_EXT` in `lib/media.js`.

- **A build slug cannot write outside its emit directory.** `build.resources.
  <name>.slug` may name any field, not just a `slug`-typed one — and the value
  is user-writable data that becomes a filename, so `../../x` in a plain string
  field escaped `into`. The filename is now `path.basename` of the value; a
  slug-typed field was and remains safe by its own grammar.

- **A read returns only the `id` and the fields the config declares — and
  `?expand=` now obeys the target's own read rule.** Both read paths used
  `SELECT *`, so a column septic never declared rode along in responses. The
  worst case was real, not hypothetical: serve or reference the `users` table
  and every read of it shipped `password_hash` — expanding a `ref:users` field
  on a public resource handed it to anonymous callers. Now rows are shaped to
  the declared fields, and expanding a ref means passing the referenced
  resource's `access.read`; a ref into a table the config does not serve stays
  an id for everyone. Upgrading: if you relied on undeclared columns appearing
  in responses, declare them; if you expand a ref, the target must be a
  configured resource.

### Changed

- **`build` writes only what changed.** It used to `rm` each emit dir and
  rewrite every file on every run, so a watcher over the tree — an editor,
  poops's own watch, laxative's dev loop — saw a full rewrite on a no-op build,
  and there was a moment mid-build where the tree was empty. Markup files and
  form partials are now written only when their content differs; files from
  deleted rows are swept afterwards. The contract is unchanged: an emit dir is
  wholly septic-owned, and anything in it not keyed by a current row is still
  removed.

### Fixed

- **Every `datetime` is stored in one shape.** A `datetime-local` input sends
  `2026-08-06T12:00` and it was stored verbatim, while `= now` stamps
  `2026-08-06 12:00:00` — and since `'T'` sorts after `' '`, a table holding
  both shapes mis-sorts on `ORDER BY` and misses equality filters. Client
  values are now normalized to the `YYYY-MM-DD HH:MM:SS` UTC shape on
  validation; an offset-less value is read in the server's timezone. Edit forms
  do the reverse: the stored shape is converted back to the `T` form a
  `datetime-local` input accepts, where previously the browser dropped the
  value and showed an empty picker. Rows written before this change keep their
  old shape until next edited.

- **`POST {}` to a resource whose fields are all optional creates a row instead
  of a 500.** With nothing to insert the SQL came out as `INSERT INTO t ()
  VALUES ()`, a SQLite syntax error; it is now `INSERT ... DEFAULT VALUES` —
  an empty create is still a create, and returns the new row with its `id`.

- **A checkbox can now be unchecked on an edit form.** An unchecked checkbox is
  absent from an HTML submit, and the edit path deliberately leaves omitted
  fields alone — so once a boolean was on, no form could turn it off. The
  rendered checkbox now sits over a hidden `value="0"` input: unchecked posts
  the 0, checked posts both and the validator takes the last value.

### Added

- **A misspelt key in the `septic` block is now named when the config loads.**
  `"methdos"` on a resource was read by nothing: the methods you meant to allow
  were never allowed, and the first sign was a 404 you did not expect. Every
  command routes through `loadConfig`, so every command says it:

  ```
  💩 septic: unknown key "methdos" in septic.resources.posts — ignored. Valid: fields, methods, access, fieldAccess, indexes, unique
  ```

  Key names only, and only inside the `septic` block — the rest of `poops.json`
  belongs to Poops and to whoever else shares the file. Resource and field names
  are yours and are never reported; a typo inside one is. Types still fail where
  they are read. The walk is
  [unknown-keys](https://github.com/stamat/unknown-keys), a new dependency with
  none of its own.

- **A JSON Schema for the `septic` block**, shipped as `schema/septic.schema.json`
  and published at `https://stamat.info/septic/septic.schema.json`. Point
  `$schema` at it and the editor completes and validates the whole block —
  including the field DSL, which is a plain string, so nothing in JSON could
  previously tell `"string required"` from `"strng requried"` and septic only
  found out at boot. It describes the `septic` block and leaves the rest of
  `poops.json` alone; the README shows the two-line `allOf` that composes it
  with Poops' own schema when you want both checked in one file.

  A test pins the schema's DSL pattern to `parseField`, so the two cannot drift:
  every spec the parser accepts, the schema accepts. It is stricter in exactly
  one place, deliberately — `"string ="` parses to an empty-string default and
  the schema flags it — and stricter about `ondelete=` too, which the parser
  takes on any field but only a `ref:` ever reads.

## [1.0.0] - 2026-08-06 — one config, a backend

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
