// -----------------------------------------------------------------------------
// Session-store migration runner.
//
// Parallel structure to @wanda/event-log's migration runner, with a separate
// `_meta` key (`session_schema_version`) so the two packages can share a DB
// without colliding on version metadata.
//
// Canonical migrations are inlined as `BUILT_IN_MIGRATIONS` so the package
// works after being bundled (e.g. inside an Electron app.asar where the
// sibling `migrations/` directory isn't reachable on disk). The .sql files
// in `packages/session/migrations/` are the human-editable source and must be
// mirrored into the constant below when changed.
// -----------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { MigrationError } from './errors.ts'

export const SESSION_SCHEMA_VERSION_KEY = 'session_schema_version'

const MIGRATION_FILE_RE = /^(\d{3,})-[\w.-]+\.sql$/

export interface Migration {
  readonly id: string
  readonly filename: string
  readonly sql: string
}

// Mirrors packages/session/migrations/001-initial.sql. Update both together.
const MIGRATION_001_INITIAL_SQL = `-- Migration 001 — initial session schema.
-- Idempotent so re-running is a no-op.

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The server's stable identity. Exactly one row for the lifetime of a Wanda
-- install. \`epoch_crc\` detects torn writes on the epoch counter — mismatch
-- means the file is corrupted and we refuse to boot.
CREATE TABLE IF NOT EXISTS server_identity (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  epoch       INTEGER NOT NULL DEFAULT 1,
  epoch_crc   INTEGER NOT NULL
);

-- A paired client's persistent session. sessionToken is the long-lived bearer
-- credential stored client-side; it survives WS reconnects, app restarts, and
-- device reboots. One session per (serverId, clientId) pair.
CREATE TABLE IF NOT EXISTS sessions (
  session_id      TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL UNIQUE,
  session_token   TEXT NOT NULL UNIQUE,
  device_label    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions(expires_at);
`

export const BUILT_IN_MIGRATIONS: readonly Migration[] = [
  { id: '001', filename: '001-initial.sql', sql: MIGRATION_001_INITIAL_SQL },
]

export function defaultMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../migrations')
}

export function loadMigrations(dir: string): readonly Migration[] {
  if (!existsSync(dir)) {
    throw new Error(`session-store migrations directory not found: ${dir}`)
  }
  const migrations: Migration[] = []
  for (const filename of readdirSync(dir)) {
    const match = filename.match(MIGRATION_FILE_RE)
    if (!match) continue
    const id = match[1]!
    const sql = readFileSync(join(dir, filename), 'utf8')
    migrations.push({ id, filename, sql })
  }
  migrations.sort((a, b) => a.id.localeCompare(b.id))
  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i]!.id === migrations[i - 1]!.id) {
      throw new Error(
        `duplicate session migration id ${migrations[i]!.id}: ${migrations[i - 1]!.filename} vs ${migrations[i]!.filename}`,
      )
    }
  }
  return migrations
}

export function currentSchemaVersion(db: Database.Database): string {
  db.exec(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get(SESSION_SCHEMA_VERSION_KEY) as
    | { value: string }
    | undefined
  return row?.value ?? '000'
}

export function runMigrations(
  db: Database.Database,
  source: string | readonly Migration[] = BUILT_IN_MIGRATIONS,
): { applied: string[] } {
  const migrations = typeof source === 'string' ? loadMigrations(source) : source
  const applied: string[] = []
  const current = currentSchemaVersion(db)

  for (const migration of migrations) {
    if (migration.id <= current) continue
    try {
      db.exec('BEGIN IMMEDIATE')
      db.exec(migration.sql)
      db.prepare(
        'INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).run(SESSION_SCHEMA_VERSION_KEY, migration.id)
      db.exec('COMMIT')
      applied.push(migration.id)
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* ignore */
      }
      const message = err instanceof Error ? err.message : String(err)
      throw new MigrationError(migration.id, message)
    }
  }

  return { applied }
}
