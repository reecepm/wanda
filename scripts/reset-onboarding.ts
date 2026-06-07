/**
 * Reset onboarding state so you can re-test the flow on next launch.
 *
 * Clears the `onboarding.*` and `template.defaultId` rows from the `settings`
 * table across all known Wanda user-data locations. Does NOT touch workspaces,
 * pods, or templates — only the state that decides whether onboarding runs.
 *
 * Safe to run while the app is closed. If the DB is locked by a running app,
 * the deletion for that variant is skipped with a warning.
 *
 * Usage: bun run onboarding:reset
 */

// @ts-expect-error — bun:sqlite is a Bun runtime built-in, not a typed package
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
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

let touched = 0
let missing = 0

for (const t of targets) {
  const dbPath = join(t.dir, t.dbName)
  if (!existsSync(dbPath)) {
    console.log(`  skip  ${t.label.padEnd(20)}  (not found)`)
    missing++
    continue
  }

  try {
    const db = new Database(dbPath)
    try {
      const deleted = db
        .prepare(`DELETE FROM settings WHERE key LIKE 'onboarding.%' OR key = 'template.defaultId'`)
        .run()
      console.log(`  wipe  ${t.label.padEnd(20)}  (${deleted.changes} row(s) removed)`)
      touched++
    } finally {
      db.close()
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('database is locked') || message.includes('SQLITE_BUSY')) {
      console.warn(`  busy  ${t.label.padEnd(20)}  (app is running — close it and re-run)`)
    } else {
      console.error(`  err   ${t.label.padEnd(20)}  ${message}`)
      process.exit(1)
    }
  }
}

console.log(`\nDone. Cleared onboarding state in ${touched} DB(s); ${missing} variant(s) had no DB.`)
console.log('Next launch will show the onboarding flow from the start.')
