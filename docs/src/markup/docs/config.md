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
| `?limit=&offset=` | paginate (limit capped at 200) |
| `?sort=<col>&order=asc\|desc` | order by a column |
| `?<col>=value` | equality filter |
| `?expand=<refField>` | inline a `ref:` field's referenced row |

Column names are checked against the schema; unknown params are ignored.

## Users & auth

septic owns a `users` table (email, role, password_hash). A `users` resource in config **extends** it with your own columns (`display_name`, `avatar_url`, …). Sessions are stateless signed cookies — set `SEPTIC_SECRET` in production.
