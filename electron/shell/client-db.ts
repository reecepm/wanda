// -----------------------------------------------------------------------------
// Client-local SQLite for paired-server metadata.
//
// Distinct from the wanda-server DB (which holds pods, terminals, workflows).
// This file lives in the Electron main process and tracks the user's paired
// servers: which servers, which base URLs, which session tokens.
//
// Storage is split across two tables, both in the same SQLite file:
//
//   `servers` — owned by @wanda/router's ServerRegistry (paired-server id,
//               serverId, baseUrl, label, pairedAt). Schema + migrations are
//               package-owned.
//   `client_session_tokens` — local sidecar. Holds the session-token
//               ciphertext + last-connected timestamp keyed by the
//               registry id @wanda/router issues.
//
// Session tokens stay encrypted via `encryptSecret` / `decryptSecret`
// (AES-256-GCM in prod, test double in tests). The ClientDb facade hides
// the table split from callers.
// -----------------------------------------------------------------------------

import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ServerRegistry } from '@wanda/router'
import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3'

export interface PairedServerRecord {
  readonly id: string
  readonly serverId: string
  readonly label: string
  readonly baseUrl: string
  readonly addedAt: number
  readonly lastConnectedAt: number | null
}

export interface ClientDb {
  list(): PairedServerRecord[]
  get(id: string): PairedServerRecord | null
  insert(record: Omit<PairedServerRecord, 'addedAt' | 'lastConnectedAt'> & { sessionTokenCiphertext: string }): void
  remove(id: string): void
  /** Returns the stored ciphertext (never decrypted). */
  getRawSessionTokenCiphertext(id: string): string | null
  /** Bump last_connected_at to now. */
  markConnected(id: string): void
  /** Swap the stored baseUrl for a paired row — used after a port-heal. */
  updateBaseUrl(id: string, baseUrl: string): void
  close(): void
}

const SIDECAR_SCHEMA = `
CREATE TABLE IF NOT EXISTS client_session_tokens (
  registry_id               TEXT PRIMARY KEY,
  session_token_ciphertext  TEXT NOT NULL,
  last_connected_at         INTEGER
);
`

export function createClientDb(dbPath: string): ClientDb {
  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })

  const sqlite: BetterSqliteDatabase = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')

  // The package runs its own migrations on construct; it also sets WAL
  // PRAGMAs (no-op when we've already set them).
  const registry = new ServerRegistry(sqlite)

  sqlite.exec(SIDECAR_SCHEMA)

  // One-time backfill: if the pre-migration `paired_servers` table exists,
  // copy its rows into the new `servers` + `client_session_tokens` split.
  // Drops the legacy table afterward so subsequent boots skip this path.
  const legacyExists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='paired_servers'")
    .get() as { name?: string } | undefined
  if (legacyExists?.name === 'paired_servers') {
    const legacyRows = sqlite
      .prepare('SELECT id, server_id, label, base_url, session_token_ciphertext, last_connected_at FROM paired_servers')
      .all() as Array<{
      id: string
      server_id: string
      label: string
      base_url: string
      session_token_ciphertext: string
      last_connected_at: number | null
    }>
    const tx = sqlite.transaction(() => {
      for (const r of legacyRows) {
        sqlite
          .prepare(
            'INSERT OR IGNORE INTO servers (registry_id, server_id, base_url, label, paired_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(r.id, r.server_id, r.base_url, r.label, Date.now())
        sqlite
          .prepare(
            'INSERT OR IGNORE INTO client_session_tokens (registry_id, session_token_ciphertext, last_connected_at) VALUES (?, ?, ?)',
          )
          .run(r.id, r.session_token_ciphertext, r.last_connected_at)
      }
      sqlite.exec('DROP TABLE paired_servers')
    })
    tx()
  }

  const sidecarInsert = sqlite.prepare(
    `INSERT INTO client_session_tokens (registry_id, session_token_ciphertext, last_connected_at)
     VALUES (?, ?, NULL)
     ON CONFLICT(registry_id) DO UPDATE SET session_token_ciphertext = excluded.session_token_ciphertext`,
  )
  const sidecarGetToken = sqlite.prepare(
    'SELECT session_token_ciphertext FROM client_session_tokens WHERE registry_id = ?',
  )
  const sidecarGet = sqlite.prepare('SELECT last_connected_at FROM client_session_tokens WHERE registry_id = ?')
  const sidecarAll = sqlite.prepare('SELECT registry_id, last_connected_at FROM client_session_tokens')
  const sidecarRemove = sqlite.prepare('DELETE FROM client_session_tokens WHERE registry_id = ?')
  const sidecarMarkConnected = sqlite.prepare(
    'UPDATE client_session_tokens SET last_connected_at = ? WHERE registry_id = ?',
  )

  function enrich(
    registryId: string,
    serverId: string,
    label: string,
    baseUrl: string,
    pairedAt: number,
  ): PairedServerRecord {
    const row = sidecarGet.get(registryId) as { last_connected_at?: number | null } | undefined
    return {
      id: registryId,
      serverId,
      label,
      baseUrl,
      addedAt: pairedAt,
      lastConnectedAt: row?.last_connected_at ?? null,
    }
  }

  return {
    list() {
      // Pre-load all sidecar lastConnectedAt in one query to avoid N+1.
      const connectedByRegistry = new Map<string, number | null>()
      for (const row of sidecarAll.all() as Array<{ registry_id: string; last_connected_at: number | null }>) {
        connectedByRegistry.set(row.registry_id, row.last_connected_at)
      }
      return registry.list().map((s) => ({
        id: s.registryId,
        serverId: s.serverId,
        label: s.label,
        baseUrl: s.baseUrl,
        addedAt: s.pairedAt,
        lastConnectedAt: connectedByRegistry.get(s.registryId) ?? null,
      }))
    },
    get(id) {
      const s = registry.findByRegistryId(id)
      if (!s) return null
      return enrich(s.registryId, s.serverId, s.label, s.baseUrl, s.pairedAt)
    },
    insert(record) {
      // Wrap the two writes in a single transaction so a crash between
      // them can't leave a server row without its session token (or the
      // reverse, which would hand a naked ciphertext out at boot).
      const tx = sqlite.transaction((r: typeof record) => {
        // The package's pair() uses server_id as the dedup key and returns
        // the existing row on conflict. We want a deterministic registryId
        // (the caller already picked one) so we don't rely on pair() — the
        // router API reserves `registry_id` as package-owned, but nothing
        // stops us from inserting explicitly.
        sqlite
          .prepare(
            'INSERT OR REPLACE INTO servers (registry_id, server_id, base_url, label, paired_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(r.id, r.serverId, r.baseUrl, r.label, Date.now())
        sidecarInsert.run(r.id, r.sessionTokenCiphertext)
      })
      tx(record)
    },
    remove(id) {
      const tx = sqlite.transaction(() => {
        registry.unpair(id)
        sidecarRemove.run(id)
      })
      tx()
    },
    getRawSessionTokenCiphertext(id) {
      const row = sidecarGetToken.get(id) as { session_token_ciphertext?: string } | undefined
      return row?.session_token_ciphertext ?? null
    },
    markConnected(id) {
      sidecarMarkConnected.run(Date.now(), id)
    },
    updateBaseUrl(id, baseUrl) {
      registry.updateBaseUrl(id, baseUrl)
    },
    close() {
      sqlite.close()
    },
  }
}
