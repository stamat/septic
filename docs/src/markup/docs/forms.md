---
layout: poops-docs-theme/docs
title: Forms & the poops bridge
description: Generate working forms and a static site from the same config.
order: 4
---

# Forms & the poops bridge

## Forms

A `build.forms` block emits an HTML `<form>` per resource, from the same field DSL that made the table, wired to the resource's `/api` endpoint.

```json
"build": {
  "forms": {
    "messages": {
      "into": "src/markup/_partials",
      "success": "/thanks",
      "hints": { "body": { "widget": "textarea" }, "email": { "help": "We'll only reply here" } }
    }
  }
}
```

Field types map to inputs — `slug`→`pattern`, `enum`→`<select>`, `ref:`→`<select>` from the DB, `email`→`type=email`, `image`→file input. `id` and `datetime = now` fields are omitted.

**They work.** The create/update routes content-negotiate:

| Client | Success | Error |
|--------|---------|-------|
| HTMX | `HX-Redirect`, or a "Saved" fragment | `422` + the form re-rendered with errors + values |
| Browser (no JS) | `303` redirect (Post/Redirect/Get) | `422` + the re-rendered form |
| API (JSON) | `201` + JSON | `422` + JSON |

### Editing

`GET /api/:resource/:id` as a writer wanting HTML returns a prefilled edit form (PUT via HTMX `hx-put`, or POST + `_method=PUT` for no-JS). Editing never re-applies defaults, so `created` survives.

### Progressive validation

Native HTML5 validation fires from the emitted attributes with no JS. Include `assets/septic-forms.js` and those same native checks drive styled inline messages — no rules duplicated. The server (`validate.js`) stays the authority.

## The poops bridge

`septic build` turns DB rows into markup and runs poops:

```json
"build": {
  "resources": {
    "posts": {
      "into": "src/markup/posts", "slug": "slug", "body": "body", "layout": "post.html",
      "where": { "status": "published" }
    }
  }
}
```

Each row → `src/markup/posts/<slug>.md` (front matter + body), kept in step — only changed files are rewritten, deleted rows are swept — then poops compiles the site. `where` is optional — an equality filter (multiple keys ANDed, values bound) so drafts stay out of the static site while the API still serves them. One config, one dataset — a live API **and** a static site. poops is an optional peer: markup is always written; if poops isn't installed, `septic build` emits the markup and says so.

## Where they meet: one origin

An emitted form posts to a **relative** `/api/<resource>`, so it works only when the page and the API answer on the same host. septic serves `/api` and `/uploads`; the compiled site is poops output, and nothing in septic serves it. Two processes on two ports means the form posts into the void.

[laxative](https://stamat.info/laxative) is the piece that closes that: it boots septic's app, serves the built site behind it, and rebuilds on change — `laxative dev` in development, `laxative serve` in production. Same host, same port, no CORS to configure. Prefer your own server? Mount `createServer(config).app` beside your static handler — see [the exports](index#as-a-library).
