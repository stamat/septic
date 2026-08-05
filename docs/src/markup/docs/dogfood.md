---
layout: poops-docs-theme/docs
title: Dogfood
description: septic runs pooppress's real schema.
order: 7
---

# Dogfood

The 1.0 test for septic was whether [pooppress](https://github.com/stamat/pooppress) — a real CMS whose backend was hand-written before septic existed — can be expressed as a septic config. It can.

## Two proofs

- **`test/dogfood.test.js`** builds pooppress's whole schema (six tables) from a septic config and asserts the columns, indexes, FK on-delete actions and generated forms.
- **`test/dogfood-live.test.js`** stands up pooppress's **committed migration verbatim** and points septic at that database — serving real CRUD, field access, filtering and expand over it, honouring pooppress's own COALESCE slug index and NOT NULL DEFAULT columns, without altering the schema.

## Honest scope

This proves septic can be pooppress's **backend / data layer**. It is *not* a rewrite of pooppress's application code — its routes, admin UI, WXR import, deploy and build scheduler stay in pooppress and call into septic. That separation is by design: septic emits forms and data, it is not a hosted admin panel.

See [`docs/DOGFOOD.md`](https://github.com/stamat/septic/blob/main/docs/DOGFOOD.md) in the repo for the full mapping.
