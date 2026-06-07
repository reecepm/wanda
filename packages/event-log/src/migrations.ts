// -----------------------------------------------------------------------------
// Migration runner.
//
// The canonical migrations are inlined as `BUILT_IN_MIGRATIONS` so the package
// works after being bundled (where the sibling `migrations/` directory may not
// be reachable on disk — e.g. inside an Electron app.asar). The .sql files in
// `packages/event-log/migrations/` remain the human-editable source of truth
// and are mirrored into the constant below.
//
// `runMigrations` accepts either the inlined array (default) OR a directory
// path (used by tests that point at fixture migrations).
// -----------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { MigrationError } from './errors.ts'

export interface Migration {
  readonly id: string // zero-padded numeric prefix, e.g. '001'
  readonly filename: string
  readonly sql: string
}

export const CURRENT_SCHEMA_VERSION_KEY = 'schema_version'

const MIGRATION_FILE_RE = /^(\d{3,})-[\w.-]+\.sql$/

// Mirrors packages/event-log/migrations/001-initial.sql. Update both together.
const MIGRATION_001_INITIAL_SQL = `-- Migration 001 — initial event-log schema.
-- Idempotent (IF NOT EXISTS) so reopen on already-migrated DBs is a no-op.

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  epoch         INTEGER NOT NULL,
  channel       TEXT    NOT NULL,
  resource_kind TEXT    NOT NULL,
  resource_id   TEXT    NOT NULL,
  payload_json  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS events_by_resource ON events(resource_kind, resource_id, seq DESC);
CREATE INDEX IF NOT EXISTS events_by_seq_epoch ON events(epoch, seq);
`

export const BUILT_IN_MIGRATIONS: readonly Migration[] = [
  { id: '001', filename: '001-initial.sql', sql: MIGRATION_001_INITIAL_SQL },
]

/**
 * Default migrations directory, relative to this compiled module. Only
 * useful when the package source is reachable on disk (dev/tests). Production
 * callers should rely on the inlined `BUILT_IN_MIGRATIONS`.
 */
export function defaultMigrationsDir(): string {
  const hereUrl = import.meta.url
  const here = dirname(fileURLToPath(hereUrl))
  return resolve(here, '../migrations')
}

export function loadMigrations(dir: string): readonly Migration[] {
  if (!existsSync(dir)) {
    throw new Error(`event-log migrations directory not found: ${dir}`)
  }
  const entries = readdirSync(dir)
  const migrations: Migration[] = []
  for (const filename of entries) {
    const match = filename.match(MIGRATION_FILE_RE)
    if (!match) continue
    const id = match[1]!
    const sql = readFileSync(join(dir, filename), 'utf8')
    migrations.push({ id, filename, sql })
  }
  migrations.sort((a, b) => a.id.localeCompare(b.id))
  // Duplicate-id guard: two files with the same numeric prefix would silently
  // race on version comparison.
  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i]!.id === migrations[i - 1]!.id) {
      throw new Error(
        `duplicate migration id ${migrations[i]!.id}: ${migrations[i - 1]!.filename} vs ${migrations[i]!.filename}`,
      )
    }
  }
  return migrations
}

export function currentSchemaVersion(db: Database.Database): string {
  // _meta may not exist yet on a fresh DB. We create it on demand as part of
  // the bootstrap migration (001 runs CREATE TABLE IF NOT EXISTS _meta), but
  // we need to be able to read it safely before any migration runs too.
  db.exec(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get(CURRENT_SCHEMA_VERSION_KEY) as
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
  const currentVersion = currentSchemaVersion(db)

  for (const migration of migrations) {
    if (migration.id <= currentVersion) continue

    // Transactional apply — on any error, BEGIN/ROLLBACK leaves the DB at the
    // prior version. `exec` can run multi-statement SQL.
    try {
      db.exec('BEGIN IMMEDIATE')
      db.exec(migration.sql)
      db.prepare(
        'INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).run(CURRENT_SCHEMA_VERSION_KEY, migration.id)
      db.exec('COMMIT')
      applied.push(migration.id)
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* best-effort — db may already be in aborted state */
      }
      const message = err instanceof Error ? err.message : String(err)
      throw new MigrationError(migration.id, message)
    }
  }

  return { applied }
}
