// -----------------------------------------------------------------------------
// ServerRegistry — paired-server lifecycle + stale-entry detection.
//
// Backed by SQLite so the set of paired servers survives client restarts.
// The server's self-declared `serverId` (from hello-ack) is checked on every
// reconnect; mismatch means a fresh server install on that baseUrl, and the
// old registry entry is stale (the user must re-pair).
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { ServerNotFoundError } from './errors.ts'
import { runMigrations } from './migrations.ts'
import type { PairedServer } from './types.ts'

export interface ServerRegistryOptions {
  readonly now?: () => number
  readonly newRegistryId?: () => string
  readonly migrationsDir?: string
}

export class ServerRegistry {
  private readonly now: () => number
  private readonly newRegistryId: () => string

  private readonly stmts: {
    insert: Database.Statement
    selectById: Database.Statement
    selectByServerId: Database.Statement
    selectAll: Database.Statement
    updateBaseUrl: Database.Statement
    updateServerId: Database.Statement
    delete: Database.Statement
  }

  constructor(db: Database.Database, opts: ServerRegistryOptions = {}) {
    this.now = opts.now ?? Date.now
    this.newRegistryId = opts.newRegistryId ?? (() => randomBytes(12).toString('hex'))

    // If event-log or router already opened the DB the pragmas are no-ops;
    // otherwise set them here so a standalone ServerRegistry works.
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('busy_timeout = 30000')
    runMigrations(db, opts.migrationsDir)

    this.stmts = {
      insert: db.prepare(
        'INSERT INTO servers (registry_id, server_id, base_url, label, paired_at) VALUES (?, ?, ?, ?, ?)',
      ),
      selectById: db.prepare(
        'SELECT registry_id, server_id, base_url, label, paired_at FROM servers WHERE registry_id = ?',
      ),
      selectByServerId: db.prepare(
        'SELECT registry_id, server_id, base_url, label, paired_at FROM servers WHERE server_id = ?',
      ),
      selectAll: db.prepare(
        'SELECT registry_id, server_id, base_url, label, paired_at FROM servers ORDER BY paired_at ASC',
      ),
      updateBaseUrl: db.prepare('UPDATE servers SET base_url = ? WHERE registry_id = ?'),
      updateServerId: db.prepare('UPDATE servers SET server_id = ? WHERE registry_id = ?'),
      delete: db.prepare('DELETE FROM servers WHERE registry_id = ?'),
    }
  }

  pair(opts: { serverId: string; baseUrl: string; label: string }): PairedServer {
    if (!opts.serverId) throw new Error('pair: serverId required')
    if (!opts.baseUrl) throw new Error('pair: baseUrl required')
    if (!opts.label) throw new Error('pair: label required')

    // If a registry entry already exists for this serverId, return it rather
    // than double-pair. The UI can update baseUrl / label separately.
    const existing = this.stmts.selectByServerId.get(opts.serverId) as RawRow | undefined
    if (existing) return this.rowToServer(existing)

    const registryId = this.newRegistryId()
    const pairedAt = this.now()
    this.stmts.insert.run(registryId, opts.serverId, opts.baseUrl, opts.label, pairedAt)
    return {
      registryId,
      serverId: opts.serverId,
      baseUrl: opts.baseUrl,
      label: opts.label,
      pairedAt,
    }
  }

  unpair(registryId: string): boolean {
    return this.stmts.delete.run(registryId).changes > 0
  }

  findByRegistryId(registryId: string): PairedServer | null {
    const row = this.stmts.selectById.get(registryId) as RawRow | undefined
    return row ? this.rowToServer(row) : null
  }

  findByServerId(serverId: string): PairedServer | null {
    const row = this.stmts.selectByServerId.get(serverId) as RawRow | undefined
    return row ? this.rowToServer(row) : null
  }

  list(): PairedServer[] {
    return (this.stmts.selectAll.all() as RawRow[]).map((r) => this.rowToServer(r))
  }

  updateBaseUrl(registryId: string, baseUrl: string): void {
    const info = this.stmts.updateBaseUrl.run(baseUrl, registryId)
    if (info.changes === 0) throw new ServerNotFoundError(registryId)
  }

  /**
   * If the gateway's hello-ack reports a serverId different from the one we
   * stored, the pairing is stale (a re-install on the other end). Returns
   * true if stale and deletes the row so the UI prompts for re-pair.
   */
  detectStale(registryId: string, observedServerId: string): boolean {
    const row = this.stmts.selectById.get(registryId) as RawRow | undefined
    if (!row) return false
    if (row.server_id === observedServerId) return false
    this.stmts.delete.run(registryId)
    return true
  }

  private rowToServer(r: RawRow): PairedServer {
    return {
      registryId: r.registry_id,
      serverId: r.server_id,
      baseUrl: r.base_url,
      label: r.label,
      pairedAt: r.paired_at,
    }
  }
}

interface RawRow {
  registry_id: string
  server_id: string
  base_url: string
  label: string
  paired_at: number
}
