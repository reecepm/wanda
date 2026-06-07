// -----------------------------------------------------------------------------
// OutboxService — durable queue for paired-server mutations.
//
// Problem: the renderer fires mutations against paired servers through an
// oRPC client that POSTs HTTP. If the paired server is unreachable when
// the mutation fires, the call fails and there's nothing to retry from.
// The user loses work silently.
//
// Solution: persist every paired mutation through @wanda/router's Outbox
// before firing. On failure the entry stays in the queue; on bridge
// reconnect the service drains everything pending for that registryId
// against a live oRPC client.
//
// Ownership: this service lives in the Electron main process because
// @wanda/router.Outbox is backed by better-sqlite3 (Node-only), and
// because the paired session tokens it needs to authenticate are stored
// main-side. The renderer calls in via IPC.
// -----------------------------------------------------------------------------

import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { Outbox, type OutboxEntry } from '@wanda/router'
import type { AnyResourceRef } from '@wanda/wire'
import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { AppClient } from '../../shared/contracts'
import type { ServerRegistry } from './server-registry'

export interface OutboxFireResult {
  readonly ok: boolean
  readonly outboxId: string
  readonly result: unknown
  readonly error: string | null
}

export interface OutboxPendingEntry {
  readonly id: string
  readonly registryId: string
  readonly method: string
  readonly input: unknown
  readonly createdAt: number
  readonly retries: number
  readonly lastError: string | null
}

export interface OutboxService {
  enqueueAndFire(registryId: string, method: string, input: unknown, ref?: AnyResourceRef): Promise<OutboxFireResult>
  drainForRegistry(registryId: string): Promise<Array<{ entryId: string; ok: boolean; error: string | null }>>
  listPending(registryId?: string): OutboxPendingEntry[]
  removeEntry(id: string): boolean
  /**
   * Fires a drain when the given registry's bridge reconnects. The caller
   * (wired in from the renderer via IPC) decides when "reconnected" means.
   */
  onEntryApplied(cb: (entry: { outboxId: string; registryId: string; method: string }) => void): () => void
  close(): void
}

export interface OutboxServiceOpts {
  /**
   * Path to the client-local SQLite file. Usually the same file
   * `ClientDb` opens — both layers share the `@wanda/router` migration
   * that creates the `outbox` + `servers` tables, so opening a second
   * handle here is safe under WAL.
   */
  readonly dbPath: string
  readonly serverRegistry: ServerRegistry
  /** clientId used for Outbox idempotency keys. Stable per-device. */
  readonly clientId: string
  /** Override fetch for tests. */
  readonly fetchImpl?: typeof fetch
}

const ROUTING_SCHEMA = `
CREATE TABLE IF NOT EXISTS outbox_routing (
  outbox_id   TEXT PRIMARY KEY,
  registry_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_routing_by_registry ON outbox_routing(registry_id);
`

export function createOutboxService(opts: OutboxServiceOpts): OutboxService {
  const sqlite: BetterSqliteDatabase = new Database(opts.dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.exec(ROUTING_SCHEMA)

  // The Outbox class runs its own router migrations — safe to re-run
  // because they're idempotent (`CREATE TABLE IF NOT EXISTS`).
  const outbox = new Outbox(sqlite, { clientId: opts.clientId })

  const insertRouting = sqlite.prepare('INSERT OR REPLACE INTO outbox_routing (outbox_id, registry_id) VALUES (?, ?)')
  const getRouting = sqlite.prepare('SELECT registry_id FROM outbox_routing WHERE outbox_id = ?')
  const removeRouting = sqlite.prepare('DELETE FROM outbox_routing WHERE outbox_id = ?')
  const listRouting = sqlite.prepare('SELECT outbox_id, registry_id FROM outbox_routing WHERE registry_id = ?')
  const listAllRouting = sqlite.prepare('SELECT outbox_id, registry_id FROM outbox_routing')

  const clients = new Map<string, AppClient>()
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)

  function clientFor(registryId: string): AppClient | null {
    const existing = clients.get(registryId)
    if (existing) return existing
    const srv = opts.serverRegistry.list().find((s) => s.id === registryId)
    if (!srv) return null
    const token = opts.serverRegistry.getSessionToken(registryId)
    if (!token) return null
    const link = new RPCLink({
      url: srv.baseUrl,
      headers: () => ({ authorization: `Bearer ${token}` }),
      fetch: doFetch,
    })
    const c = createORPCClient<AppClient>(link)
    clients.set(registryId, c)
    return c
  }

  /** Force a client rebuild — baseUrl or token may have changed. */
  function dropClient(registryId: string): void {
    clients.delete(registryId)
  }

  const appliedSubs = new Set<(e: { outboxId: string; registryId: string; method: string }) => void>()
  function notifyApplied(outboxId: string, registryId: string, method: string): void {
    for (const cb of appliedSubs) {
      try {
        cb({ outboxId, registryId, method })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[outbox] onEntryApplied sub threw', err)
      }
    }
  }

  /**
   * Walk `method = 'ns.sub.op'` down the oRPC client to the callable
   * leaf, then invoke with `input`. Returns whatever the RPC returns.
   * Throws on network / RPC errors — the caller distinguishes.
   */
  async function invokeMethod(client: AppClient, method: string, input: unknown): Promise<unknown> {
    const parts = method.split('.')
    // oRPC client nests procedures as callable proxies — each level is
    // `typeof 'function'`, not `'object'`. Accept both so we can descend
    // through `client.workspace.create` correctly.
    let cursor: unknown = client
    for (const part of parts) {
      if (cursor == null || (typeof cursor !== 'object' && typeof cursor !== 'function')) {
        throw new Error(`outbox: invalid method path "${method}" (stopped at ${part})`)
      }
      cursor = (cursor as Record<string, unknown>)[part]
    }
    if (typeof cursor !== 'function') {
      throw new Error(`outbox: method "${method}" did not resolve to a callable`)
    }
    return await (cursor as (input: unknown) => Promise<unknown>)(input)
  }

  function isTransientFailure(err: unknown): boolean {
    // Network-shaped failures we want to retry.
    const msg = err instanceof Error ? err.message : String(err)
    if (
      /fetch failed|ECONNREFUSED|ENETUNREACH|ENOTFOUND|ETIMEDOUT|timeout|aborted|socket hang up|EAI_AGAIN/i.test(msg)
    ) {
      return true
    }
    // HTTP 5xx is retryable.
    if (/\b5\d\d\b/.test(msg)) return true
    return false
  }

  function toPending(entry: OutboxEntry, registryId: string): OutboxPendingEntry {
    return {
      id: entry.id,
      registryId,
      method: entry.method,
      input: entry.input,
      createdAt: entry.createdAt,
      retries: entry.retries,
      lastError: entry.lastError,
    }
  }

  async function fireEntry(entry: OutboxEntry, registryId: string): Promise<OutboxFireResult> {
    const client = clientFor(registryId)
    if (!client) {
      const err = `outbox: no paired client available for ${registryId}`
      outbox.markRetry(entry.id, err)
      return { ok: false, outboxId: entry.id, result: null, error: err }
    }
    try {
      const result = await invokeMethod(client, entry.method, entry.input)
      outbox.remove(entry.id)
      removeRouting.run(entry.id)
      notifyApplied(entry.id, registryId, entry.method)
      return { ok: true, outboxId: entry.id, result, error: null }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (isTransientFailure(err)) {
        outbox.markRetry(entry.id, msg)
        // The session token may have rotated or the baseUrl changed —
        // drop the cached client so next drain picks up fresh values.
        dropClient(registryId)
        return { ok: false, outboxId: entry.id, result: null, error: msg }
      }
      // Non-transient — the server explicitly rejected the mutation
      // (bad input, auth, etc.). Remove rather than pile up retries.
      outbox.remove(entry.id)
      removeRouting.run(entry.id)
      return { ok: false, outboxId: entry.id, result: null, error: msg }
    }
  }

  return {
    async enqueueAndFire(registryId, method, input, ref) {
      const entry = outbox.enqueue({ method, input: input ?? null, ref: ref ?? null })
      insertRouting.run(entry.id, registryId)
      return await fireEntry(entry, registryId)
    },

    async drainForRegistry(registryId) {
      const rows = listRouting.all(registryId) as Array<{ outbox_id: string; registry_id: string }>
      const results: Array<{ entryId: string; ok: boolean; error: string | null }> = []
      for (const row of rows) {
        const entry = outbox.findById(row.outbox_id)
        if (!entry) {
          removeRouting.run(row.outbox_id)
          continue
        }
        const res = await fireEntry(entry, registryId)
        results.push({ entryId: entry.id, ok: res.ok, error: res.error })
        if (!res.ok) break // preserve order: stop on first failure, retry on next drain
      }
      return results
    },

    listPending(registryId) {
      const rows = registryId
        ? (listRouting.all(registryId) as Array<{ outbox_id: string; registry_id: string }>)
        : (listAllRouting.all() as Array<{ outbox_id: string; registry_id: string }>)
      const out: OutboxPendingEntry[] = []
      for (const row of rows) {
        const e = outbox.findById(row.outbox_id)
        if (e) out.push(toPending(e, row.registry_id))
      }
      return out
    },

    removeEntry(id) {
      const row = getRouting.get(id) as { registry_id?: string } | undefined
      const ok = outbox.remove(id)
      if (row) removeRouting.run(id)
      return ok
    },

    onEntryApplied(cb) {
      appliedSubs.add(cb)
      return () => {
        appliedSubs.delete(cb)
      }
    },

    close() {
      clients.clear()
      appliedSubs.clear()
      sqlite.close()
    },
  }
}
