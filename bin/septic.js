#!/usr/bin/env node
import { loadConfig } from '../lib/config.js'
import { createServer, prepareDb } from '../lib/server.js'

const [cmd] = process.argv.slice(2)

if (cmd === 'serve') {
  const config = loadConfig()
  const { app } = createServer(config)
  const port = Number(process.env.PORT) || 3000
  const count = Object.keys(config.resources).length
  app.listen(port, () => console.log(`💩 septic serving ${count} resource(s) on http://localhost:${port}`))
} else if (cmd === 'build') {
  const config = loadConfig()
  const { db } = prepareDb(config)
  const { build } = await import('../lib/build.js')
  const { written, forms, compiled } = await build(config, db)
  db.close()
  const pages = Object.entries(written).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing'
  const formsMsg = forms.length ? `, ${forms.length} form(s)` : ''
  console.log(`💩 septic wrote ${pages}${formsMsg}${compiled ? ' → poops build' : ' (poops not installed — markup only)'}`)
} else {
  console.log('Usage: septic <serve|build>   (reads ./poops.json)')
  process.exit(cmd ? 1 : 0)
}
