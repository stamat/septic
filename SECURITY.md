# Security Policy

## Reporting a vulnerability

Report privately via a
[GitHub security advisory](https://github.com/stamat/septic/security/advisories/new).
Do not open a public issue. Expect an initial response within a few days.

## Supported versions

septic is pre-1.0. Only the latest release receives fixes.

## Operational notes

- **Set `SEPTIC_SECRET` in production.** Sessions are HMAC-signed with it;
  without it a random secret is generated per process, so sessions drop on
  restart and cannot be shared across workers.
- **`auth.seed` is a dev convenience.** Never ship a known seed password to
  production — seed once, then rotate.
- Access defaults deny writes: a resource with no `access.write` requires the
  `admin` role.
