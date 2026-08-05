---
layout: poops-docs-theme/docs
title: "How-to: a blog"
description: Write posts in a DB, publish a static site — the poops bridge, filtered to published.
order: 6
---

# How-to: a blog

The blog is what septic is *for*: posts live in a database, and `septic build` turns the published ones into a static site via poops. One config; drafts never ship.

## 1. The posts resource

```json
{
  "septic": {
    "db": "data/blog.db",
    "auth": { "seed": { "email": "you@example.com", "password": "changeme", "role": "admin" } },
    "resources": {
      "posts": {
        "methods": ["GET", "POST", "PUT", "DELETE"],
        "access": { "read": "public", "write": "admin" },
        "fields": {
          "title":        "string required",
          "slug":         "slug required unique",
          "body":         "text required",
          "excerpt":      "text",
          "status":       "enum(draft,published) = draft",
          "published_at": "datetime",
          "created":      "datetime = now",
          "updated":      "datetime = now!"
        }
      }
    }
  }
}
```

## 2. Wire the bridge — published only

```json
"build": {
  "resources": {
    "posts": {
      "into": "src/markup/posts",
      "slug": "slug",
      "body": "body",
      "layout": "post.html",
      "where": { "status": "published" }
    }
  }
}
```

`where` is the important bit: `septic build` emits **only** published rows, so drafts stay out of the static site. Each post becomes `src/markup/posts/<slug>.md` — YAML front matter (title, excerpt, published_at, …) + the body — regenerated clean each build, then poops compiles the site.

## 3. Write a post

```sh
npx septic serve
# log in
curl -c jar -X POST localhost:3000/api/_auth/login \
  -H 'content-type: application/json' -d '{"email":"you@example.com","password":"changeme"}'
# publish one
curl -b jar -X POST localhost:3000/api/posts -H 'content-type: application/json' \
  -d '{"title":"Hello","slug":"hello","body":"# Hi\n\nFirst post.","status":"published","published_at":"2026-08-05 12:00:00"}'
```

## 4. Build the static site

```sh
npx septic build      # published posts → src/markup/posts/*.md → poops → dist/
```

A `post.html` layout renders each post; a `posts/index.html` lists the collection — that part is [poops](https://stamat.info/poops), the static-site generator. A minimal layout:

{% raw %}
```html
<!-- post.html -->
<article>
  <h1>{{ page.title }}</h1>
  <time>{{ page.published_at }}</time>
  {{ content }}
</article>
```
{% endraw %}

## 5. Author from a form (optional)

Add `build.forms` for a write/edit form:

```json
"build": { "forms": { "posts": { "into": "src/markup/_partials", "submitLabel": "Publish" } } }
```

`GET /api/posts/:id` as an admin wanting HTML returns a prefilled **edit form** (PUT). See [Forms](forms).

## What you got

Posts in a database → a static blog, drafts excluded, from one config. For the full app — an admin page to write posts, served next to the site — see the same how-to in [laxative](https://stamat.info/laxative/docs/howto-blog/).
