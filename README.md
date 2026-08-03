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

---

Did you figure out yet that I'm a fan of toilet humor?

MIT © Stamat
