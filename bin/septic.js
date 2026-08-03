#!/usr/bin/env node
import { loadConfig } from '../lib/config.js'
import { createServer } from '../lib/server.js'

const [cmd] = process.argv.slice(2)

if (cmd === 'serve') {
  const config = loadConfig()
  const { app } = createServer(config)
  const port = Number(process.env.PORT) || 3000
  const count = Object.keys(config.resources).length
  app.listen(port, () => console.log(`💩 septic serving ${count} resource(s) on http://localhost:${port}`))
} else {
  console.log('Usage: septic serve   (reads ./poops.json)')
  process.exit(cmd ? 1 : 0)
}
