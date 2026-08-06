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

This is the surface laxative composes; it is public and versioned, so build on it rather than on `lib/*` paths.
