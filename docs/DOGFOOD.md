# Dogfooding pooppress on septic

The 1.0 test for septic was whether [pooppress](https://github.com/stamat/pooppress)
— a real CMS whose `server/` was hand-written before septic existed — can be
expressed as a septic config. Measured against pooppress's actual schema
(`server/migrations/001-init.sql`).

**Verdict: it fits — this is 1.0.** Every table maps; `test/dogfood.test.js`
builds the whole schema and asserts the tables, columns, indexes, foreign-key
actions and generated forms.

## The mapping (v1.0)

| pooppress table | septic |
|-----------------|--------|
| `users` | ✅ septic owns the base (email/role/password_hash); a `users` resource **extends** it with `display_name`, `avatar_url`, … |
| `collections` | ✅ plain DSL fields |
| `posts` | ✅ `ref:` collection/author with `ondelete=`, `enum` status, `json` meta, `updated = now!`, composite `unique`, secondary `indexes`, `fieldAccess` so authors can't publish |
| `media` | ✅ `image` field → upload + `sharp` variants |
| `settings` | ✅ key + `json` value |
| `sessions` | n/a — septic uses stateless signed cookies |

## What closed the gaps

| Gap (was) | Now |
|-----------|-----|
| Media | `file`/`image` types, multer upload, sharp variants, static serving |
| `updated_at` | `= now!` touch fields |
| Extensible users | a `users` resource ALTERs septic's auth table |
| FK on-delete | `ref:x ondelete=cascade\|setnull\|restrict` |
| Composite unique | resource-level `unique: [["collection","slug"]]` |
| `json` type | stored as TEXT, hydrated to object on read |
| Secondary indexes | resource-level `indexes` |
| Field-level rules | `fieldAccess: { status: { write: [...] } }` |

## What stays in pooppress — by design

septic is the data layer, not the whole app. These remain pooppress's, and that
is the correct separation, not a gap:

- The **admin UI** (login screens, dashboards) — septic emits forms, it is not a
  hosted panel (see CONTRIBUTING's refusals).
- **WXR import**, **deploy**, **preview tokens**, the **build scheduler/lock** —
  application behaviour on top of the data.
- The **poops build bridge** wiring is septic's `septic build`; pooppress's
  content-specific export shape sits above it.

## Why this is 1.0

1.0 is an API-stability promise, and the bar we set was "pooppress fits." It
does: the field DSL and resource-config surface now express the whole schema, so
freezing them is a promise we can keep. `test/dogfood.test.js` is the proof and
the regression guard.
