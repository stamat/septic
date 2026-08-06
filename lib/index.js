// Public API — what other tools (laxative) compose septic through.
export { createServer, prepareDb } from './server.js'
export { loadConfig } from './config.js'
export { build, toMarkup } from './build.js'
export { emitForms, formHtml } from './forms.js'
export { parseResources, parseResource } from './schema.js'
export { openDb } from './db.js'
// The data layer, for a host application with its own routes: same access rules,
// same field shaping, no HTTP round trip to reach its own database.
export { createStore, resourceStore, AccessError, NotFoundError, ConflictError } from './data.js'
export { ValidationError } from './validate.js'
// For a host that keeps its own sessions but shares the users table: the same
// scrypt shape either side, so credentials created by one verify in the other.
export { hashPassword, verifyPassword } from './auth.js'
// One resource's REST surface, mountable inside a host's own express app —
// createServer is just this per resource plus auth and uploads.
export { crudRouter } from './crud.js'
