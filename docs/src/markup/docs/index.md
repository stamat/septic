---
layout: poops-docs-theme/docs
title: Overview
description: What septic is and how the pieces fit.
order: 1
---

# Overview

septic turns a `septic` block in your `poops.json` into a working backend:

- **Schema** — a field DSL defines resources; septic creates the SQLite tables.
- **REST API** — auto CRUD per resource, à la carte by method, gated by role.
- **Forms** — generate HTML forms from the same fields, wired to the API, that actually work (HTMX or no-JS).
- **The poops bridge** — `septic build` materializes rows into markup and runs poops, so the same data serves a live API *and* a static site.

Everything is opt-in by config presence — nothing mounts unless you declare it.

## Where septic sits

The ecosystem is three organs reading one `poops.json`:

| Organ | Its job | You reach for it when |
|-------|---------|-----------------------|
| [poops](https://stamat.info/poops) | bundler + static-site generator | you have pages to compile |
| **septic** | schema, REST API, generated forms, the build bridge | those pages need data |
| [laxative](https://stamat.info/laxative) | conductor — runs both on **one origin** | a form on the built page must POST to `/api` on the host that served it |

That last row is the reason to know laxative exists: `npx septic serve` mounts `/api` and `/uploads` and nothing else. It never serves the site poops built. Running them as one thing is laxative's whole job, and septic reimplements none of it.

CRUD, auth and validation are commodities — PocketBase and Supabase do them well. septic's one distinct job is the shared config and the poops bridge. That is the reason to use it inside this ecosystem, and the reason it stays small.

## Install

```sh
npm i septic
```

Requires Node ≥ 22. `better-sqlite3` is an npm native addon (no separate binary to drag around).

## As a library

The CLI is one caller of the same exports; another tool can mount septic inside its own server instead of shelling out.

```js
import { loadConfig, createServer } from 'septic'

const config = loadConfig()
const { app, db } = createServer(config)
app.listen(3000)
```

| Export | Returns |
|--------|---------|
| `loadConfig(root?, file?)` | the resolved config from a `poops.json` — throws if it has no `septic` block |
| `prepareDb(config)` | `{ db, resources }` — DB open, users table, resource tables, admin seed |
| `createServer(config)` | `{ app, db }` — the express app with routes mounted; it never listens |
| `build(config, db, { compile })` | `{ written, forms, compiled }` — rows → markup, then poops if installed |
| `toMarkup(row, spec?)` | one row as a front-matter document string |
| `emitForms(config, db)` | the emitted form partials, keyed by resource |
| `formHtml(resource, spec?, { db, values, errors, id })` | one `<form>` as a string |
| `parseResource(name, def)` / `parseResources(defs)` | the field DSL → resource descriptors |
| `openDb(path)` | the raw better-sqlite3 handle (WAL, FKs on) |
| `createStore(db, resources)` | `{ [resource]: operations }` — the data layer, below |
| `resourceStore(db, resource, all?)` | one resource's operations |

This is the surface laxative composes; it is public and versioned, so build on it rather than on `lib/*` paths.

## The data layer

An application with its own routes — an admin panel, a CMS — needs what sits *under* the REST API, not the API itself. Reaching your own database over HTTP to satisfy your own request handler is a round trip that buys nothing.

```js
import { prepareDb, createStore } from 'septic'

const { db, resources } = prepareDb(config)
const store = createStore(db, resources)

store.posts.list({ user, where: { status: 'published' }, sort: 'created', order: 'desc' })
store.posts.create({ title: 'Hello', slug: 'hello' }, { user })
```

| Operation | Notes |
|-----------|-------|
| `list({ user, where, limit, offset, sort, order, expand })` | `where` is equality on declared columns; unknown keys are ignored. No 200 cap — that clamp guards an untrusted query string, which is the router's boundary, not yours |
| `count({ user, where })` | the same rule as `list` |
| `get(id, { user, expand })` | throws `NotFoundError` rather than returning null |
| `raw(id, { user })` | the stored row, undeclared columns and all — for a caller that owns the table and needs a column the config does not declare |
| `create(data, { user })` | returns the new row, shaped |
| `update(id, data, { user, partial })` | `partial: true` touches only what it was given |
| `remove(id, { user })` | `true`, or `NotFoundError` |

**The rules are the same ones the API applies**, because the router calls exactly these methods: `access.read`/`access.write` per call, `fieldAccess` per field (an unwritable field is dropped, so the rest of the edit survives), reads shaped to the declared fields — an undeclared column stays in the database — and `expand` obeying the referenced resource's own read rule.

`user` is the one thing you pass. Omit it and the call reads as anonymous, which `allows` denies for anything not declared `"public"`, so a forgotten argument fails closed. `raw` is the deliberate exception to the shaping, named rather than a flag, so nobody reaches it by accident.

Failures throw, each carrying a `.status` the caller can map: `ValidationError` (422, with an `errors` map of every field that failed), `AccessError` (401 anonymous / 403 known user), `NotFoundError` (404), `ConflictError` (409 duplicate, 422 dangling reference).
