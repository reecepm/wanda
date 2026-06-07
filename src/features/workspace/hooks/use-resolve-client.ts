import { useCallback } from 'react'
import { createServerPool, getServerSessionToken, useServers } from '@/features/servers'
import { orpcForPod, parseNamespacedId } from '@/shared/orpc'
import { wrapPairedClientWithOutbox } from '@/shared/paired-client-outbox'
import type { AppClient } from '../../../../shared/contracts'

// Paired-server fan-out pool. Module-scoped because the sidebar mounts once
// — we memoize per (server.id × baseUrl) so re-renders don't rebuild oRPC
// clients. Separate from the Machines-page pool so cache invalidation on
// one page doesn't cross-invalidate the other.
export const sidebarPool = createServerPool({
  getSessionToken: getServerSessionToken,
})

type ClientResolution = { client: AppClient; realId: string }

export type ResolveClient = (id: string) => Promise<ClientResolution>

/**
 * Resolve an oRPC client + unwrapped uuid for any namespaced id used in the
 * sidebar. Used by mutation handlers so sidebar actions on a remote workspace
 * / pod actually talk to the authoritative server, not the laptop's own local
 * server. This is the linchpin — without it, every single sidebar action
 * (create pod, rename, delete, etc.) silently runs against the wrong backend
 * and the user sees nothing.
 */
export function useResolveClient(): ResolveClient {
  const { data: pairedServers = [] } = useServers()

  return useCallback(
    async (id: string): Promise<ClientResolution> => {
      const parsed = parseNamespacedId(id)
      if (!parsed) return { client: orpcForPod(null), realId: id }
      const server = pairedServers.find((s) => s.id === parsed.registryId)
      if (!server) {
        console.warn('[workspace-explorer] no paired server for registry id; falling back to local', {
          id,
          registryId: parsed.registryId,
        })
        return { client: orpcForPod(null), realId: parsed.rawId }
      }
      const conn = await sidebarPool.clientFor(server)
      // Route mutations for this paired server through the main-process
      // outbox so a transient disconnect during a sidebar action doesn't
      // silently lose the user's intent. Queries pass through.
      return { client: wrapPairedClientWithOutbox(conn.client, server.id), realId: parsed.rawId }
    },
    [pairedServers],
  )
}
