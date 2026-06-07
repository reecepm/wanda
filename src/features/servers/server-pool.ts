// Connection pool for paired servers.
//
// Memoizes one PairedServerClient per (server.id × server.baseUrl). Renderer
// hooks ask the pool for a client by server descriptor; the pool reuses a
// cached instance unless the baseUrl changed (e.g. user re-paired against
// a new address) or the entry was explicitly removed.
//
// The pool intentionally does not own the React lifecycle — it lives in
// module scope and is re-used across hook invocations. Closing the app
// drops it implicitly.

import type { PairedServerView } from '../../../shared/contracts/servers'
import {
  type CreatePairedServerClientOpts,
  createPairedServerClient,
  type PairedServerClient,
} from './server-connection'

export interface ServerPool {
  clientFor(server: PairedServerView): Promise<PairedServerClient>
  remove(serverId: string): void
  clear(): void
}

export interface CreateServerPoolOpts {
  /**
   * Resolve the session token for a paired server. Production wires this
   * to `window.wanda.servers.getSessionToken`. May return null when the
   * server is no longer paired or the token has been forgotten.
   */
  getSessionToken: (id: string) => Promise<string | null>
  /** Override factory — tests inject a stub. */
  clientFactory?: (opts: CreatePairedServerClientOpts) => PairedServerClient
}

interface CacheEntry {
  baseUrl: string
  client: PairedServerClient
}

export function createServerPool(opts: CreateServerPoolOpts): ServerPool {
  const cache = new Map<string, CacheEntry>()
  const factory = opts.clientFactory ?? createPairedServerClient

  return {
    async clientFor(server) {
      const cached = cache.get(server.id)
      if (cached && cached.baseUrl === server.baseUrl) return cached.client

      const token = await opts.getSessionToken(server.id)
      if (!token) {
        throw new Error(`no session token for paired server ${server.id} (${server.label})`)
      }

      const client = factory({ baseUrl: server.baseUrl, sessionToken: token })
      cache.set(server.id, { baseUrl: server.baseUrl, client })
      return client
    },

    remove(serverId) {
      cache.delete(serverId)
    },

    clear() {
      cache.clear()
    },
  }
}
