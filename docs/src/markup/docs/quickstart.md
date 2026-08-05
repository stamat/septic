---
layout: poops-docs-theme/docs
title: Quick start
description: A resource to a running API in a minute.
order: 2
---

# Quick start

Add a `septic` block to `poops.json`:

```json
{
  "septic": {
    "db": "data/app.db",
    "auth": { "seed": { "email": "you@example.com", "password": "changeme", "role": "admin" } },
    "resources": {
      "notes": {
        "methods": ["GET", "POST", "PUT", "DELETE"],
        "access": { "read": "public", "write": "admin" },
        "fields": { "title": "string required", "body": "text" }
      }
    }
  }
}
```

Serve it:

```sh
npx septic serve       # http://localhost:3000
```

Generated routes (only the `methods` you list):

| Method | Route | Gate |
|--------|-------|------|
| GET    | `/api/notes` (`?limit=&offset=&sort=&<col>=`) | `access.read` |
| GET    | `/api/notes/:id` | `access.read` |
| POST   | `/api/notes` | `access.write` |
| PUT    | `/api/notes/:id` | `access.write` |
| DELETE | `/api/notes/:id` | `access.write` |

Log in with `POST /api/_auth/login {email, password}` (sets a signed session cookie), then write.

Build a static site from the data with `npx septic build` (see [the poops bridge](forms#the-poops-bridge)).
