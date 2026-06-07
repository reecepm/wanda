// Per-package migration runner. Namespaced `_meta` key so multiple @wanda/*
// packages can share a SQLite file.
//
// Canonical migrations are inlined in `BUILT_IN_MIGRATIONS` so the package
// works after being bundled (e.g. inside an Electron app.asar where the
// sibling `migrations/` directory isn't reachable on disk). The .sql files
// in `packages/router/migrations/` are the human-editable source and must be
// mirrored into the constant below when changed.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { MigrationError } from './errors.ts'

export const ROUTER_SCHEMA_VERSION_KEY = 'router_schema_version'

const MIGRATION_FILE_RE = /^(\d{3,})-[\w.-]+\.sql$/

export interface Migration {
  readonly id: string
  readonly filename: string
  readonly sql: string
}

// Mirrors packages/router/migrations/001-initial.sql. Update both together.
const MIGRATION_001_INITIAL_SQL = `-- Migration 001 — outbox + server registry persistence.

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- In-flight mutations that survived a client crash or a disconnect. Each row
-- holds enough JSON to re-execute the RPC. The \`idempotency_key\` is a
-- version-prefixed deterministic hash so server-side dedup survives retries
-- from any process that held the same clientId.
CREATE TABLE IF NOT EXISTS outbox (
  id              TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  method          TEXT NOT NULL,
  input_json      TEXT NOT NULL,
  ref_json        TEXT,               -- AnyResourceRef or null
  created_at      INTEGER NOT NULL,
  retries         INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT
);

CREATE INDEX IF NOT EXISTS outbox_by_created ON outbox(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS outbox_by_idempotency ON outbox(idempotency_key);

-- Paired-server registry. \`serverId\` is the server's self-declared identity;
-- \`registry_id\` is the local opaque handle consumers pass around.
CREATE TABLE IF NOT EXISTS servers (
  registry_id  TEXT PRIMARY KEY,
  server_id    TEXT NOT NULL,
  base_url     TEXT NOT NULL,
  label        TEXT NOT NULL,
  paired_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS servers_by_server_id ON servers(server_id);
`

export const BUILT_IN_MIGRATIONS: readonly Migration[] = [
  { id: '001', filename: '001-initial.sql', sql: MIGRATION_001_INITIAL_SQL },
]

/**
 * Resolves the on-disk migrations directory shipped with the source package.
 * Only useful when the package source is reachable on disk (dev/tests).
 * Production callers should rely on the inlined `BUILT_IN_MIGRATIONS`.
 */
export function defaultMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../migrations')
}

export function loadMigrations(dir: string): readonly Migration[] {
  if (!existsSync(dir)) throw new Error(`router migrations dir not found: ${dir}`)
  const migrations: Migration[] = []
  for (const filename of readdirSync(dir)) {
    const m = filename.match(MIGRATION_FILE_RE)
    if (!m) continue
    const id = m[1]!
    migrations.push({ id, filename, sql: readFileSync(join(dir, filename), 'utf8') })
  }
  migrations.sort((a, b) => a.id.localeCompare(b.id))
  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i]!.id === migrations[i - 1]!.id) {
      throw new Error(`duplicate router migration id: ${migrations[i]!.id}`)
    }
  }
  return migrations
}

export function currentSchemaVersion(db: Database.Database): string {
  db.exec(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get(ROUTER_SCHEMA_VERSION_KEY) as
    | { value: string }
    | undefined
  return row?.value ?? '000'
}

export function runMigrations(
  db: Database.Database,
  source: string | readonly Migration[] = BUILT_IN_MIGRATIONS,
): void {
  const migrations = typeof source === 'string' ? loadMigrations(source) : source
  const current = currentSchemaVersion(db)
  for (const m of migrations) {
    if (m.id <= current) continue
    try {
      db.exec('BEGIN IMMEDIATE')
      db.exec(m.sql)
      db.prepare(
        'INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).run(ROUTER_SCHEMA_VERSION_KEY, m.id)
      db.exec('COMMIT')
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* ignore */
      }
      throw new MigrationError(m.id, err instanceof Error ? err.message : String(err))
    }
  }
}
