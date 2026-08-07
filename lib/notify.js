// The "tell me when a form lands" wall, without the SMTP dependency: septic
// tells a URL, the URL tells you — Slack, ntfy, a mail API, anything with a
// webhook is one config line, where an SMTP client is a new dependency and a
// deliverability problem septic should not own.
//
//   "notify": { "url": "https://…", "events": ["create"], "resources": ["messages"] }
//
// `events` defaults to ["create"] — the MVP case is "a form landed", and
// update/delete opt in by name. `resources` absent means every resource.
// Fire and forget: a notification must never fail the write it reports, so
// the response never waits on it and a failure is a warning, not an error.
export function notifier(config) {
  const spec = config?.notify
  if (!spec?.url) return null
  const events = new Set(spec.events || ['create'])
  const resources = spec.resources ? new Set(spec.resources) : null
  return (event, resource, row) => {
    if (!events.has(event)) return
    if (resources && !resources.has(resource)) return
    // Bounded: an unanswered webhook must not pile up sockets behind it.
    fetch(spec.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, resource, row }),
      signal: AbortSignal.timeout(spec.timeout || 5000)
    }).catch((err) => console.warn(`💩 septic: notify ${event} ${resource} failed — ${err.message}`))
  }
}
