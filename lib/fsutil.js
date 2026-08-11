import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Write only when the content differs. A no-op build must not rewrite a file it
// didn't change, or a watcher over the tree (an editor, poops-watch, laxative
// dev) wakes on every build — the quietness invariant both the markup emit and
// the form emit depend on, in one place so it can't drift between them.
export function writeIfChanged(file, content) {
  if (!existsSync(file) || readFileSync(file, 'utf8') !== content) writeFileSync(file, content)
}
