---
layout: poops-docs-theme/docs
title: Config & field DSL
description: The field DSL, resource options, querying and access.
order: 3
---

# Config & field DSL

## Field DSL

`"<type>[ flag]... [ = default]"`

- **types:** `string` `text` `slug` `email` `integer` `boolean` `datetime` `json` `file` `image` `enum(a,b,c)` `ref:<resource>`
- **flags:** `required` `unique` `ondelete=cascade|setnull|restrict` (ref only)
- **default:** `= value` — `= now` fills a `datetime` at insert; `= now!` also re-stamps it on every update (an `updated_at`)

Changing fields against a live database: an added field becomes a column in place, but nullable and **without its `unique` constraint** — SQLite's `ALTER TABLE ADD COLUMN` cannot carry one, and nothing above the database enforces uniqueness, so a `unique` field added to a table that already exists accepts duplicates where the same config on a fresh database returns `409`. A removed or renamed field leaves its old column behind, named in a startup warning and never dropped — a rename still needs a real migration: hand-written SQL, run against the database outside septic, the way [pooppress owns its own](dogfood.html). `boolean` is stored as SQLite `0`/`1` and comes back from the API as `true`/`false`. A `datetime` is stored and read as UTC: a value with no offset (what a `datetime-local` input posts) is taken as UTC so it round-trips unchanged, and an explicit offset (`…Z`, `…+02:00`) is honoured.

## Resource options

```json
"posts": {
  "methods": ["GET", "POST", "PUT", "DELETE"],
  "access": { "read": "public", "write": ["editor", "admin"] },
  "fieldAccess": { "status": { "write": ["editor", "admin"] } },
  "unique": [{ "columns": ["collection", "slug"], "coalesce": { "collection": 0 } }],
  "indexes": [["status", "published_at"]],
  "fields": { "…": "…" }
}
```

- **access** — `"public"`, a role, or a list of roles; `admin` passes everything.
- **fieldAccess** — who may set a given field (an author submitting `status=published` just can't).
- **unique** — composite; the `coalesce` form makes a NULL a sentinel so null-key rows still collide.
- **indexes** — secondary indexes.

## Querying a list

| Param | Effect |
|-------|--------|
| `?limit=&offset=` | paginate — 50 by default, capped at 200 |
| `?sort=<col>&order=asc\|desc` | order by a column |
| `?<col>=value` | equality filter — a `boolean` column takes `true`/`false` as well as `1`/`0`; a repeated or bracketed key (`?a=1&a=2`, `?a[x]=1`) is a `422`, not a `500` |
| `?expand=<refField>` | inline a `ref:` field's referenced row — the target must be a configured resource and the caller must pass its `access.read` |

Column names are checked against the schema; unknown params are ignored. Responses carry the `id` plus the declared fields — an undeclared column (like `password_hash` on a served `users` table) never leaves the database.

## Users & auth

septic owns a `users` table (email, role, password_hash). A `users` resource in config **extends** it with your own columns (`display_name`, `avatar_url`, …). Sessions are stateless signed cookies — set `SEPTIC_SECRET` in production. The cookie is `HttpOnly; SameSite=Lax`, and gains `Secure` under `NODE_ENV=production` (or `auth.secureCookies: true`), so the token never rides a plain-http request.
