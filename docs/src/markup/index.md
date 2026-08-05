---
layout: poops-docs-theme/prose
title: septic
description: Config-driven backend for the poops ecosystem — one poops.json → SQLite + REST + generated forms.
---

# 🚽 septic

**Config-driven backend for the [poops](https://github.com/stamat/poops) ecosystem.** One `poops.json`, a `septic` block → a SQLite schema, a REST API, generated forms, and the poops static-site bridge. The backend twin of the poops frontend.

It exists to share poops's config and feed its static build — not to compete with PocketBase or Supabase on features. Node-native, no dragged binaries, deliberately small.

```json
{
  "septic": {
    "db": "data/app.db",
    "resources": {
      "posts": {
        "access": { "read": "public", "write": "admin" },
        "fields": {
          "title":  "string required",
          "slug":   "slug unique",
          "body":   "text",
          "status": "enum(draft,published) = draft",
          "created": "datetime = now"
        }
      }
    }
  }
}
```

Define a resource once → get the table, the REST API, a create/edit form, and a static page — from one config.

[Read the docs →](docs/) · [GitHub →](https://github.com/stamat/septic)
