# Security Policy

## Reporting a vulnerability

Report privately via a
[GitHub security advisory](https://github.com/stamat/septic/security/advisories/new).
Do not open a public issue. Expect an initial response within a few days.

## Supported versions

Only the latest release receives fixes.

## Operational notes

- **Set `SEPTIC_SECRET` in production.** Sessions are HMAC-signed with it;
  without it a random secret is generated per process, so sessions drop on
  restart and cannot be shared across workers.
- **`auth.seed` is a dev convenience.** Never ship a known seed password to
  production — seed once, then rotate.
- **Uploads keep their extension and are served back unfiltered.** A stored file
  gets a random name but the original suffix, and there is no MIME allowlist —
  so an `.html` or `.svg` accepted by a resource with public write access is
  returned as active content from whatever origin serves `media.url`. Gate
  `file`/`image` writes by role, or serve `media.url` from a host that is not
  your site's.
- Access defaults deny writes: a resource with no `access.write` requires the
  `admin` role.
