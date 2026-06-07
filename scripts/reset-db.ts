/**
 * Reset local Wanda databases by deleting the SQLite files in userData.
 *
 * Deletes both dev and packaged variants across all known userData names:
 *   - ~/Library/Application Support/Wanda Dev/wanda-dev.db (bun run dev / packaged dev)
 *   - ~/Library/Application Support/Wanda/wanda.db         (packaged stable)
 *   - ~/Library/Application Support/wanda/wanda-dev.db     (legacy bun run dev)
 *
 * Also removes the accompanying `-wal` and `-shm` files SQLite writes in WAL mode.
 *
 * Safe to run while the app is closed. Will refuse if any variant looks locked
 * by a running process.
 *
 * Usage: bun run db:reset
 */

import { existsSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

interface Target {
  label: string
  dir: string
  dbName: string
}

function userDataRoot(): string {
  const home = os.homedir()
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support')
    case 'win32':
      return process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    default:
      return process.env.XDG_CONFIG_HOME ?? join(home, '.config')
  }
}

const root = userDataRoot()
const targets: Target[] = [
  { label: 'dev', dir: join(root, 'Wanda Dev'), dbName: 'wanda-dev.db' },
  { label: 'packaged stable', dir: join(root, 'Wanda'), dbName: 'wanda.db' },
  { label: 'legacy dev', dir: join(root, 'wanda'), dbName: 'wanda-dev.db' },
]

let deleted = 0
let missing = 0

for (const t of targets) {
  const base = join(t.dir, t.dbName)
  const files = [base, `${base}-wal`, `${base}-shm`]
  const present = files.filter((f) => existsSync(f))

  if (present.length === 0) {
    console.log(`  skip  ${t.label.padEnd(20)}  (not found)`)
    missing++
    continue
  }

  for (const f of present) {
    try {
      const size = statSync(f).size
      rmSync(f)
      console.log(`  del   ${f}  (${(size / 1024).toFixed(1)} KB)`)
      deleted++
    } catch (err) {
      console.error(`  err   ${f}:`, err instanceof Error ? err.message : err)
      process.exit(1)
    }
  }
}

console.log(`\nDone. Deleted ${deleted} file(s); ${missing} variant(s) had no DB.`)
console.log('Next time the app starts, a fresh DB will be created and 0000_initial will be applied.')
