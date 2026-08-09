---
layout: poops-docs-theme/docs
title: "How-to: a blog"
description: Write posts in a DB, publish a static site — the poops bridge, filtered to published.
order: 6
---

# How-to: a blog

The blog is what septic is *for*: posts live in a database, and `septic build` turns the published ones into a static site via poops. One config; drafts never ship.

> **The backend half.** You end with posts in a database and a built site. Writing them from an admin page served beside that site is [laxative's version of this how-to](https://stamat.info/laxative/docs/howto-blog).

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
      "layout": "post",
      "where": { "status": "published" }
    }
  }
}
```

`where` is the important bit: `septic build` emits **only** published rows, so drafts stay out of the static site. Each post becomes `src/markup/posts/<slug>.md` — YAML front matter (title, excerpt, published_at, …) + the body — kept in step each build (only changed files rewritten, deleted rows swept), then poops compiles the site.

## 3. Write a post

```sh
npx septic serve
# log in
curl -c jar -X POST localhost:3000/api/_auth/login \
  -H 'content-type: application/json' -d '{"email":"you@example.com","password":"changeme"}'
# publish one
curl -b jar -X POST localhost:3000/api/posts -H 'content-type: application/json' \
  -d '{"title":"Hello","slug":"hello","body":"## Hi\n\nFirst post.","status":"published","published_at":"2026-08-05 12:00:00"}'
```

## 4. Build the static site

```sh
npx septic build      # published posts → src/markup/posts/*.md → poops → dist/
```

A layout renders each post; a `posts/index.html` lists the collection — that part is [poops](https://stamat.info/poops), the static-site generator. Put it at `src/markup/_layouts/post.html` and add `"options": { "includePaths": ["_layouts", "_partials"] }` to your `markup` block: poops skips `_`-prefixed directories when rendering pages and will not search them for layouts or includes unless they are on the engine's paths.

{% raw %}
```html
<!-- _layouts/post.html -->
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{{ page.title }}</title></head>
<body>
  <article>
    <h1>{{ page.title }}</h1>
    <time datetime="{{ page.published_at | date('YYYY-MM-DDTHH:mm:ss') }}">{{ page.published_at | date('D MMMM YYYY') }}</time>
    {% block content %}{% endblock %}
  </article>
</body></html>
```
{% endraw %}

Three things that page depends on: {% raw %}`{% block content %}{% endblock %}` is where the body lands — poops wraps each page's own source in that block and extends the layout, so `{{ content }}` is not a variable and renders nothing{% endraw %}; the `datetime` attribute needs ISO 8601 while septic stores `2026-08-05 12:00:00`, which is what the `date` filter is for; and the layout owns the `<h1>`, so post bodies start at `##`.

## 5. Author from a form (optional)

Add `build.forms` for a write/edit form:

```json
"build": { "forms": { "posts": { "into": "src/markup/_partials", "submitLabel": "Publish" } } }
```

`GET /api/posts/:id` as an admin wanting HTML returns a prefilled **edit form** (PUT). See [Forms](forms).

## What you got

Posts in a database → a static blog, drafts excluded, from one config. For the full app — an admin page to write posts, served next to the site — see the same how-to in [laxative](https://stamat.info/laxative/docs/howto-blog).
