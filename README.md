# 🚽 septic [![npm version](https://img.shields.io/npm/v/septic)](https://www.npmjs.com/package/septic) [![ci](https://img.shields.io/github/actions/workflow/status/stamat/septic/ci.yml?branch=main&label=ci)](https://github.com/stamat/septic/actions/workflows/ci.yml) [![license mit](https://img.shields.io/badge/license-MIT-green)](https://github.com/stamat/septic/blob/main/LICENSE)

Config-driven backend for the [poops](https://github.com/stamat/poops) ecosystem. One `poops.json`, a `septic` block → SQLite schema + REST CRUD + auth. The backend twin of the poops frontend. (A septic tank is the backend that stores and processes what poops produces.)

> **Status.** v1.0.0 — schema, CRUD, validation, auth, media, relations, forms and the poops bridge are all in, proven against pooppress's own committed migration ([DOGFOOD.md](docs/DOGFOOD.md)). Node-native, no dragged binaries. **Not on npm yet**: tags cut a GitHub Release, and publishing waits on an npm trusted publisher — install from git until then. No migrations, no realtime, no admin UI, no plugin system; [CHANGELOG.md](CHANGELOG.md) lists the limits, [CONTRIBUTING.md](CONTRIBUTING.md) says which of them are refusals. Full reference: [stamat.info/septic](https://stamat.info/septic/).

## Why it exists

Not to compete with PocketBase/Supabase/Payload — it can't and shouldn't. Its one moat: it shares `poops.json` and emits the poops static-site markup bridge. Everything else (CRUD, auth, validation) is commodity, kept deliberately minimal.

Three organs read that one config: [poops](https://github.com/stamat/poops) compiles the pages, septic serves the data, [laxative](https://github.com/stamat/laxative) runs both on one origin so a generated form posts to the host that rendered it. `septic serve` mounts `/api` and `/uploads` only — it never serves the built site, and that division is deliberate.

## Config

Add a `septic` block to `poops.json`. Presence = instantiation — nothing mounts unless declared (same à la carte model as poops).

```json
{
  "septic": {
    "db": "data/app.db",
    "auth": { "seed": { "email": "you@example.com", "password": "changeme", "role": "admin" } },
    "resources": {
      "posts": {
        "methods": ["GET", "POST", "PUT", "DELETE"],
        "access": { "read": "public", "write": "admin" },
        "fields": {
          "title":  "string required",
          "slug":   "slug unique",
          "body":   "text",
          "status": "enum(draft,review,published) = draft",
          "created": "datetime = now"
        }
      }
    }
  }
}
```

### Key checking and editor completion

A misspelt key is not an error. `"methdos"` on a resource is read by nothing, so the methods you meant to allow are simply not allowed, and the first sign is a 404 you did not expect. septic names them when it loads the config, against the schema it ships:

```
💩 septic: unknown key "methdos" in septic.resources.posts — ignored. Valid: fields, methods, access, fieldAccess, indexes, unique
```

Key names only, and only inside the `septic` block — the rest of `poops.json` belongs to Poops and to whoever else shares the file. Resource and field names are yours, so they are never reported; a typo *inside* one is. Types are not checked: `"db": 7` reaches the code that reads it and fails there, loudly.

A field spec is a string, so nothing in JSON can tell `"string required"` from `"strng requried"` — and septic only finds out at boot, if it gets that far. Point `$schema` at the shipped [JSON Schema](https://json-schema.org) and the editor completes and checks the whole block as you type, the DSL included:

```json
{
  "$schema": "./node_modules/septic/schema/septic.schema.json",
  "septic": { "db": "data/app.db" }
}
```

Or at the hosted copy, `https://stamat.info/septic/septic.schema.json`, which needs nothing installed. It describes the `septic` block and leaves the rest of `poops.json` alone; to have Poops' own keys checked in the same file, point `$schema` at a local file composing both:

```json
{
  "allOf": [
    { "$ref": "https://stamat.info/poops/poops.schema.json" },
    { "$ref": "https://stamat.info/septic/septic.schema.json" }
  ]
}
```

The schema is stricter than the parser in one place, on purpose: `"string ="` parses to an empty-string default, and the schema flags it. Everything else the parser accepts, it accepts — a test pins the two together.

### Field DSL

`"<type>[ flag]... [ = default]"`

- **types:** `string` `text` `slug` `email` `integer` `boolean` `datetime` `json` `file` `image` `enum(a,b,c)` `ref:<resource>`
- **flags:** `required` `unique` `ondelete=cascade|setnull|restrict` (ref only)
- **default:** `= value` — `= now` fills a `datetime` at insert; `= now!` also re-stamps it on every update (an `updated_at`)

Resource-level extras: `unique: [["collection","slug"]]` (composite), `indexes: [["status"]]`, `fieldAccess: { status: { write: ["editor","admin"] } }` (who may set a field). A `users` resource extends septic's built-in auth users table.

### Media

`file` and `image` fields accept multipart uploads. Set `septic.media`:

```json
"media": { "dir": "data/uploads", "url": "/uploads", "sizes": [400, 800, 1200] }
```

Uploads are stored under `dir`, served at `url`; each `image` also gets a resized variant per width in `sizes` (via `sharp`, loaded lazily). Forms with a file field switch to `multipart/form-data` automatically. An upload keeps its extension only if it is inline-safe (images, audio, video, `.pdf`, `.txt`, `.zip`); anything script-capable — `.html`, `.svg`, `.js` — is stored extension-less and served as a download, never as a page.

## Run

```sh
npm i stamat/septic    # from git — not published to npm yet
npx septic serve       # reads ./poops.json, serves the API on :3000
npx septic build       # DB rows → poops markup → static site
```

Node ≥ 22. From a clone: `script/bootstrap`, `script/server`, `script/test`.

Generated routes per resource (only the `methods` you list):

| Method | Route | Gate |
|--------|-------|------|
| GET    | `/api/:resource` (list, `?limit=&offset=`) | `access.read` |
| GET    | `/api/:resource/:id` | `access.read` |
| POST   | `/api/:resource` | `access.write` |
| PUT    | `/api/:resource/:id` (partial) | `access.write` |
| DELETE | `/api/:resource/:id` | `access.write` |

Auth: `POST /api/_auth/login` `{email, password}` sets a signed session cookie; `POST /api/_auth/logout`. Access rules are `"public"`, a role name, or a list of roles (`["editor","admin"]`); `admin` passes everything. Sessions are stateless signed cookies — **set `SEPTIC_SECRET` in production**, or the key is random per boot and every restart logs everyone out.

### Querying a list

| Param | Effect |
|-------|--------|
| `?limit=&offset=` | paginate (limit capped at 200) |
| `?sort=<col>&order=asc\|desc` | order by a column (default `id` desc) |
| `?<col>=value` | equality filter on a real column |
| `?expand=<refField>[,...]` | inline a `ref:` field's referenced row in place of its id — the target must be a configured resource and the caller must pass its `access.read`, else the id stays |

Column names are validated against the schema (no injection); unknown params are ignored. Responses carry the `id` plus the fields the config declares — a column septic never declared (a `password_hash` on a served `users` table, say) never leaves the database.

## The poops bridge

The one thing no other backend does: the same data serves a live API **and** a static site. Add a `build` block, then `septic build`.

```json
"build": {
  "resources": {
    "posts": {
      "into": "src/markup/posts", "slug": "slug", "body": "body", "layout": "post.html",
      "where": { "status": "published" }
    }
  }
}
```

Each row → `src/markup/posts/<slug>.md`: every field becomes YAML front matter, the `body` field becomes the document body, `layout` is added if named. The directory is septic-owned: only changed files are rewritten (so watchers stay quiet on a no-op build), and a deleted row leaves no orphan file. Then septic runs [poops](https://github.com/stamat/poops) over the same `poops.json` to compile the site.

`where` is an optional equality filter — only matching rows are emitted, so a blog keeps its drafts out of the static site while the API still serves them. Multiple keys are ANDed; column names come from your config and values are bound, never interpolated.

poops is an **optional peer** — markup is always written; if poops isn't installed, `septic build` emits the markup and says so.

## Forms

Add a `build.forms` block and `septic build` emits an HTML `<form>` per resource, from the same field DSL that made the table — wired to that resource's `/api` endpoint.

```json
"build": {
  "forms": {
    "messages": {
      "into": "src/markup/_partials",
      "success": "/thanks",
      "submitLabel": "Send",
      "hints": {
        "body":  { "widget": "textarea", "label": "Message" },
        "email": { "help": "We'll only use this to reply" }
      }
    }
  }
}
```

Field types map to inputs — `slug`→`pattern`, `enum`→`<select>`, `ref:x`→`<select>` from the DB, `email`→`type=email`, `boolean`→checkbox, `integer`→`type=number`. `id` and `datetime = now` fields are omitted (server-owned).

**And they work.** The create route content-negotiates:

| Client | On success | On error |
|--------|-----------|----------|
| HTMX (`HX-Request`) | `HX-Redirect` to `success`, or a "Saved" fragment | `422` + the form re-rendered with errors and the values kept |
| Browser (no JS) | `303` redirect to `success` (Post/Redirect/Get) | `422` + the re-rendered form |
| API (`Accept: application/json`) | `201` + JSON | `422` + JSON |

### Editing

`GET /api/:resource/:id`, as someone allowed to write it and wanting HTML, returns the row as a **prefilled edit form**. It submits with PUT — HTMX via `hx-put`, or no-JS via `POST` + a hidden `_method=PUT` the server honours. Editing never re-applies defaults, so a `datetime = now` (or any server-owned field) survives; clearing a required field still errors.

### Progressive validation

Native HTML5 validation fires from the emitted attributes (`required`, `pattern`, `type=email/number`) with **no JavaScript**. Include the optional `assets/septic-forms.js` and those same native checks drive styled inline messages in the `.septic-error` slot instead of browser bubbles — no rules are duplicated, it reads the browser's own `ValidityState`. The server (`validate.js`) remains the authority; the client is convenience.

```html
<script type="module" src="/path/to/septic-forms.js"></script>
```

## As a library

The CLI is one caller of the same exports, so another tool can mount septic inside its own server instead of shelling out:

```js
import { loadConfig, createServer } from 'septic'

const config = loadConfig()               // ./poops.json → the resolved config
const { app, db } = createServer(config)  // schema up, routes mounted — it never listens
app.listen(3000)                          // the port is yours
```

Also exported: `prepareDb`, `build`, `toMarkup`, `emitForms`, `formHtml`, `parseResource`, `parseResources`, `openDb` — [the reference lists what each returns](https://stamat.info/septic/docs/).

---

Did you figure out yet that I'm a fan of toilet humor?

MIT © Stamat
