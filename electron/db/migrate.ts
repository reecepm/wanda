import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { log } from '../packages/logger'
import type { AppDatabase } from './connection'

function hasColumn(db: AppDatabase, table: string, column: string): boolean {
  const rows = db.$client.pragma(`table_info(${table})`) as Array<{ name: string }>
  return rows.some((row) => row.name === column)
}

function tableExists(db: AppDatabase, table: string): boolean {
  const row = db.$client.prepare("select 1 as ok from sqlite_master where type = 'table' and name = ?").get(table) as
    | { ok: number }
    | undefined
  return !!row
}

function ensureCompatibilityColumns(db: AppDatabase): void {
  // 0016: SQLite cannot add a column idempotently from a plain migration
  // file. Keep this here so dev DBs that were manually patched and fresh DBs
  // both converge on the schema expected by `schema.ts`.
  if (tableExists(db, 'workspace_settings') && !hasColumn(db, 'workspace_settings', 'default_workenv_template_id')) {
    db.$client.exec('ALTER TABLE `workspace_settings` ADD `default_workenv_template_id` text')
  }
  // 0018: wanda mcp policy.
  if (tableExists(db, 'workspace_settings') && !hasColumn(db, 'workspace_settings', 'wanda_mcp_policy')) {
    db.$client.exec('ALTER TABLE `workspace_settings` ADD `wanda_mcp_policy` text')
  }
  if (tableExists(db, 'pods') && !hasColumn(db, 'pods', 'wanda_mcp_policy')) {
    db.$client.exec('ALTER TABLE `pods` ADD `wanda_mcp_policy` text')
  }
  // 0019: Graphite workspace settings.
  if (tableExists(db, 'workspace_settings')) {
    if (!hasColumn(db, 'workspace_settings', 'graphite_enabled')) {
      db.$client.exec('ALTER TABLE `workspace_settings` ADD `graphite_enabled` integer NOT NULL DEFAULT 0')
    }
    if (!hasColumn(db, 'workspace_settings', 'graphite_default_commit')) {
      db.$client.exec("ALTER TABLE `workspace_settings` ADD `graphite_default_commit` text NOT NULL DEFAULT 'modify'")
    }
    if (!hasColumn(db, 'workspace_settings', 'graphite_default_push')) {
      db.$client.exec(
        "ALTER TABLE `workspace_settings` ADD `graphite_default_push` text NOT NULL DEFAULT 'submitStack'",
      )
    }
    if (!hasColumn(db, 'workspace_settings', 'graphite_default_pull')) {
      db.$client.exec("ALTER TABLE `workspace_settings` ADD `graphite_default_pull` text NOT NULL DEFAULT 'sync'")
    }
    if (!hasColumn(db, 'workspace_settings', 'graphite_default_branch')) {
      db.$client.exec("ALTER TABLE `workspace_settings` ADD `graphite_default_branch` text NOT NULL DEFAULT 'create'")
    }
  }
  // 0021: workspace icon url.
  if (tableExists(db, 'workspaces') && !hasColumn(db, 'workspaces', 'icon_url')) {
    db.$client.exec('ALTER TABLE `workspaces` ADD `icon_url` text')
  }
  if (!tableExists(db, 'workenv_prebuilds')) {
    db.$client.exec(`
      CREATE TABLE IF NOT EXISTS workenv_prebuilds (
        id text PRIMARY KEY NOT NULL,
        runtime text NOT NULL,
        config_hash text NOT NULL,
        adapter_handle text,
        state text NOT NULL,
        config text NOT NULL,
        runtime_state text,
        last_error text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      );
    `)
  }
  db.$client.exec(`
    CREATE INDEX IF NOT EXISTS workenv_prebuilds_runtime_idx ON workenv_prebuilds (runtime);
    CREATE INDEX IF NOT EXISTS workenv_prebuilds_state_idx ON workenv_prebuilds (state);
    CREATE UNIQUE INDEX IF NOT EXISTS workenv_prebuilds_runtime_handle_unique ON workenv_prebuilds (runtime, adapter_handle);
    CREATE UNIQUE INDEX IF NOT EXISTS workenvs_slug_unique ON workenvs (slug);
  `)
}

/**
 * drizzle-kit's generated CREATE-NEW -> INSERT-SELECT -> DROP-OLD -> RENAME
 * recipe for schema rebuilds (e.g. dropping a column) includes a
 * `PRAGMA foreign_keys=OFF` line, but that PRAGMA is a silent no-op inside
 * an open transaction — and the drizzle migrator wraps every migration in
 * `BEGIN...COMMIT`. With FKs still enforced, the subsequent `DROP TABLE`
 * cascades through any child tables that have `ON DELETE CASCADE`, silently
 * wiping data. We turn FKs off at the connection level (where the PRAGMA
 * actually sticks) around the migrator, then restore.
 */
export function runMigrations(db: AppDatabase, migrationsFolder: string) {
  const sqlite = db.$client
  const wasOn = sqlite.pragma('foreign_keys', { simple: true }) === 1
  sqlite.pragma('foreign_keys = OFF')
  try {
    migrate(db, { migrationsFolder })
    ensureCompatibilityColumns(db)
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const cause = err instanceof Error ? err.cause : undefined
    const causeMsg = cause instanceof Error ? cause.message : cause
    log.db.error('Migration failed:', errMsg)
    log.db.error('Cause:', causeMsg ?? 'unknown')
    log.db.error('Full error:', err)
    throw err
  } finally {
    if (wasOn) sqlite.pragma('foreign_keys = ON')
  }
}
