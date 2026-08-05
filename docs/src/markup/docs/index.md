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

## Install

```sh
npm i septic
```

Requires Node ≥ 22. `better-sqlite3` is an npm native addon (no separate binary to drag around).

## The moat

CRUD, auth and validation are commodities — PocketBase and Supabase do them well. septic's one distinct job: it shares `poops.json` and emits the poops static-site bridge. That's the reason to use it inside this ecosystem, and the reason it stays small.
