# Changelog

All notable changes to septic are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Contributing an entry

Write your change under `## [Unreleased]`, grouped under `### Added`,
`### Changed`, `### Fixed`, `### Deprecated`, `### Removed` or `### Security`.
Write it for the person upgrading, not the person who wrote the code: a renamed
option, a different default, an error that is now thrown, output that moved.

## [Unreleased]

## [0.1.0] — the spine

First cut: `poops.json` config → SQLite schema → REST CRUD → validation → auth.
Node-native, no dragged binaries.

### Added

- `septic` block in `poops.json`: `db` path, `resources`, per-resource
  `methods` and `access`, and `auth.seed`. Presence = instantiation, à la carte
  like poops — nothing mounts unless declared.
- Field DSL (`lib/schema.js`): `string`, `text`, `slug`, `integer`, `boolean`,
  `datetime`, `enum(a,b,c)`, `ref:<resource>`; flags `required` / `unique`;
  `= default` (`datetime = now` fills at insert). The parsed descriptor is the
  single source of truth for both table creation and validation.
- Auto REST CRUD per resource, only for the listed `methods`; list pagination
  via `?limit=` / `?offset=`.
- Validation → HTTP: type/enum/slug/required failures `422`, unique `409`,
  missing FK `422`.
- Auth: scrypt password hashing + HMAC-signed session cookie; access rules are
  `"public"` or a role name, `admin` passes everything.
- `septic serve` CLI and `createServer(config)` for embedding and tests.
- One runnable CRUD-roundtrip check (`test/crud.test.js`, `node --test`).
