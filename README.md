# 🚽 septic

Config-driven backend for the [poops](https://github.com/stamat/poops) ecosystem. One `poops.json`, a `septic` block → SQLite schema + REST CRUD + auth. The backend twin of the poops frontend. (A septic tank is the backend that stores and processes what poops produces.)

> **Status.** v0.1 spine (config → table → CRUD → validate → auth) + the poops bridge (`septic build`). Node-native, no dragged binaries. Roadmap: relations, media, dogfooding pooppress.

## Why it exists

Not to compete with PocketBase/Supabase/Payload — it can't and shouldn't. Its one moat: it shares `poops.json` and (v0.3) emits the poops static-site markup bridge. Everything else (CRUD, auth, validation) is commodity, kept deliberately minimal.

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

### Field DSL

`"<type>[ flag]... [ = default]"`

- **types:** `string` `text` `slug` `integer` `boolean` `datetime` `enum(a,b,c)` `ref:<resource>`
- **flags:** `required` `unique`
- **default:** `= value` (`datetime = now` fills at insert)

## Run

```sh
npm install
npm run serve          # reads ./poops.json, serves the API on :3000
node bin/septic.js build   # DB rows → poops markup → static site
npm test               # the CRUD + bridge checks
```

Generated routes per resource (only the `methods` you list):

| Method | Route | Gate |
|--------|-------|------|
| GET    | `/api/:resource` (list, `?limit=&offset=`) | `access.read` |
| GET    | `/api/:resource/:id` | `access.read` |
| POST   | `/api/:resource` | `access.write` |
| PUT    | `/api/:resource/:id` (partial) | `access.write` |
| DELETE | `/api/:resource/:id` | `access.write` |

Auth: `POST /api/_auth/login` `{email, password}` sets a signed session cookie; `POST /api/_auth/logout`. Access rules are `"public"` or a role name; `admin` passes everything.

## The poops bridge

The one thing no other backend does: the same data serves a live API **and** a static site. Add a `build` block, then `septic build`.

```json
"build": {
  "resources": {
    "posts": { "into": "src/markup/posts", "slug": "slug", "body": "body", "layout": "post.html" }
  }
}
```

Each row → `src/markup/posts/<slug>.md`: every field becomes YAML front matter, the `body` field becomes the document body, `layout` is added if named. The directory is regenerated clean each run (a deleted row leaves no orphan file). Then septic runs [poops](https://github.com/stamat/poops) over the same `poops.json` to compile the site.

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

### Progressive validation

Native HTML5 validation fires from the emitted attributes (`required`, `pattern`, `type=email/number`) with **no JavaScript**. Include the optional `assets/septic-forms.js` and those same native checks drive styled inline messages in the `.septic-error` slot instead of browser bubbles — no rules are duplicated, it reads the browser's own `ValidityState`. The server (`validate.js`) remains the authority; the client is convenience.

```html
<script type="module" src="/path/to/septic-forms.js"></script>
```

---

Did you figure out yet that I'm a fan of toilet humor?

MIT © Stamat
