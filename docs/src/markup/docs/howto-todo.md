---
layout: poops-docs-theme/docs
title: "How-to: a todo manager"
description: Build a todo backend — schema, API, filtering and a form — from one config.
order: 5
---

# How-to: a todo manager

A working todo backend in one `poops.json` — table, REST API, filtering, and a form. No code.

## 1. Define the resource

```json
{
  "septic": {
    "db": "data/todos.db",
    "resources": {
      "todos": {
        "methods": ["GET", "POST", "PUT", "DELETE"],
        "access": { "read": "public", "write": "public" },
        "fields": {
          "title":   "string required",
          "done":    "boolean = false",
          "created": "datetime = now",
          "updated": "datetime = now!"
        }
      }
    }
  }
}
```

> `write: "public"` keeps the demo auth-free. For a real app use a role and log in via `POST /api/_auth/login`.

`= now` stamps `created` once; `= now!` re-stamps `updated` on every change.

## 2. Serve it

```sh
npx septic serve      # http://localhost:3000
```

## 3. Use the API

```sh
# add
curl -X POST localhost:3000/api/todos \
  -H 'content-type: application/json' -d '{"title":"buy milk"}'
# → { "id": 1, "title": "buy milk", "done": 0, "created": "...", "updated": "..." }

# list the open ones (booleans store as 0/1)
curl 'localhost:3000/api/todos?done=0&sort=created&order=desc'

# mark done — updated re-stamps automatically
curl -X PUT localhost:3000/api/todos/1 \
  -H 'content-type: application/json' -d '{"done":true}'

# delete
curl -X DELETE localhost:3000/api/todos/1
```

Filtering, sorting and pagination come for free: `?done=0`, `?sort=created&order=desc`, `?limit=&offset=`.

## 4. Add a form

Generate an HTML form for adding todos, wired to `/api/todos`:

```json
"build": {
  "forms": {
    "todos": {
      "into": "src/markup/_partials",
      "submitLabel": "Add",
      "hints": { "title": { "label": "What needs doing?" } }
    }
  }
}
```

`npx septic build` writes `src/markup/_partials/todos-form.html` — a real `<form>` with a `title` input and a `done` checkbox (`created`/`updated` are omitted, they're server-owned). It POSTs to `/api/todos` and works with HTMX or plain HTML. Include it in a poops page and you have an add-todo form on a static site, backed by the API.

## What you got

One resource definition → a `todos` table, five REST routes, validation, filtering, and a form — the whole backend of a todo app. To turn it into a full app (a page that lists and toggles todos), see the same how-to in [laxative](https://stamat.info/laxative/docs/howto-todo/).
