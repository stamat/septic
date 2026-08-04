# Dogfooding pooppress on septic

The 1.0 test for septic is whether [pooppress](https://github.com/stamat/pooppress)
— a real CMS whose `server/` was hand-written before septic existed — can be
rebuilt as a septic config. This is that assessment, mapped against pooppress's
actual schema (`server/migrations/001-init.sql`).

**Verdict: not 1.0 yet.** The core maps cleanly; several real gaps still block a
full rebuild. The honest version is below — the gaps are the roadmap.

## What maps today (v0.2)

| pooppress table | septic | Notes |
|-----------------|--------|-------|
| `collections` | ✅ full | every column is a plain DSL field (`enum` for `sort_order`, `integer` for `paginate`) |
| `posts` | 🟡 most | `ref:collections`, `ref:users`, `enum` status, `datetime` — all fine; gaps below |
| `users` | 🟡 partial | septic already owns a `users` table (email/role/password_hash); `ref:users` works against it |
| `settings` | ✅ likely | key/value resource |
| `sessions` | n/a | septic uses stateless signed cookies — no table |
| `media` | ❌ | needs file upload + image variants — deferred |

A `posts` resource in septic already generates the table, the REST API, the
create/edit forms (with `collection` and `author` as `ref:` selects and `status`
as an enum select), and the markup bridge. That is most of a CMS from one config
— the bet holds.

## The gaps (the path to 1.0)

Each is a real thing pooppress does that septic can't express yet.

| Gap | pooppress needs it for | Rough size |
|-----|------------------------|-----------|
| **Media** (upload + `sharp` variants) | the `media` table | large — its own release |
| **`updated_at`** (touch-now on every update) | audit columns | small — an `= now!` / `touch` modifier |
| **Extensible auth users** | `display_name`, `avatar_url`, role `CHECK` on the built-in users table | medium — let config extend the users resource |
| **FK on-delete actions** (`RESTRICT` / `SET NULL` / `CASCADE`) | `posts.collection_id`, `author_id` | small — `ref:x ondelete=...` |
| **Composite / expression unique** | `UNIQUE(COALESCE(collection_id,0), slug)` — slugs unique per collection | medium |
| **`json` field type** | `posts.meta`, `media.variants` | small — a `json` type over TEXT |
| **Secondary indexes** | `idx_posts_status` for scheduled publishing | small — `index` in config |
| **Field-level / transition rules** | "authors can't publish" (`status` transitions by role) | medium — beyond per-route role gates |

## Why not cut 1.0 now

1.0 is an API-stability promise. Adopting several of these gaps (extensible
users, FK actions, composite unique) will change the config surface — freezing it
before the dogfood actually runs would break that promise on the first real use.
So: **1.0 is when pooppress runs on septic**, not before. septic is roughly
two-thirds of the way — the spine, bridge, forms and queries are done; the list
above is what's left.

## Proof

`test/dogfood.test.js` builds a pooppress-shaped config (collections + posts with
both refs + status enum) and asserts septic creates the tables and generates the
posts form with populated `collection`/`author` selects — the mappable core,
exercised.
