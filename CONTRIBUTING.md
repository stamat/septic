# Contributing to septic

Issues and pull requests are welcome. Taking part means keeping to the
[Code of Conduct](CODE_OF_CONDUCT.md).

septic is the config-driven backend organ of the [poops](https://github.com/stamat/poops)
ecosystem: one `poops.json` `septic` block → a SQLite schema, a REST CRUD API,
and auth. It exists to **share poops's config and feed its static build** —
not to compete with PocketBase or Supabase on features. It stays deliberately
small and Node-native, with no dragged binaries. CRUD, auth and validation are
commodities here; the value is the poops tie-in. Features that grow septic into
a general-purpose BaaS (realtime, an admin UI, a plugin system) do not have a
home here.

## Getting set up

```bash
git clone https://github.com/stamat/septic.git
cd septic
script/bootstrap
```

```bash
script/server    # run it locally against example/poops.json
script/test      # run the tests (node --test)
script/lint      # run the linter (neostandard; CI runs it)
script/publish   # cut a release (maintainers)
```

Source of truth is `lib/`. The field DSL parsed in `lib/schema.js` produces the
descriptor that **both** the DB layer and `lib/validate.js` read — change the
grammar in one place. Tests live in `test/`; there is no build step, the library
ships as source.

## Reporting a bug

[Open an issue](../../issues/new/choose) — the form asks for what you ran, what
you expected, the version and the environment, because those are the four things
every fix starts from. A reproduction is worth more than a description of one.

## Pull requests

- **Add a test.** A bug fix gets a test that fails without the fix.
- **Match the surrounding style.** `script/lint` is the authority, and CI runs it.
- **Add a changelog entry** under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
- **Keep the diff about one thing.** A rename bundled with a fix is two reviews
  wearing one hat.
- **Agent-written code is welcome — you still own it.** Same bar as handwritten:
  tests, lint, CI green, and you can answer review questions on every line.
  Point your agent at [AGENTS.md](AGENTS.md) before it starts.

Commit messages are freeform; write something that says what changed.

## How a release works

Maintainer flow, recorded here so the automation isn't a mystery:

`script/publish [version]` takes the current version from the last `v*` tag,
writes the new one into `package.json` with `script/version`, runs
`script/changelog` to cut `[Unreleased]` into a released entry, commits, tags and
pushes. There is no `script/build` — the library ships as source. It then offers
to open the GitHub release with that changelog entry as the body, which is why
the release is created from there and not from the workflow.

Pushing the tag triggers [publish.yml](.github/workflows/publish.yml), which
publishes to npm over trusted publishing: OIDC, no token stored anywhere, and the
tarball gets a provenance attestation.
