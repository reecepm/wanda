// Active pod client — local or remote.
//
// The sidebar now lists workspaces/pods from every paired server, with
// remote IDs namespaced as `remote:<registryId>:<realPodId>` so they
// can't collide with local UUIDs in route state. When the user clicks
// one, the pod page route still looks like `/pods/$podId` — but `$podId`
// might be a remote one. This hook does three things for the rest of
// the pod-page hooks:
//
//   1. Decodes `podId` → `{ kind: 'local' | 'remote', realPodId, … }`.
//   2. For remote pods, builds (and memoizes) an oRPC RPCLink pointed at
//      the right paired server, using the session token cached in the
//      main-process registry.
//   3. Exposes `client` that the caller should use instead of the
//      bare `orpc` import. For local pods it returns the same local
//      client; for remote, a paired client against the remote baseUrl.
//
// Keep this hook pure: it must never tear down the remote WS, never
// write to the renderer's query cache. The pod-page hooks compose it.

import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { getServerSessionToken, listPairedServers } from '@/features/servers/use-servers'
import { orpcForPod } from '@/shared/orpc'
import { wrapPairedClientWithOutbox } from '@/shared/paired-client-outbox'
import type { AppClient } from '../../../../shared/contracts'

export interface ActivePodClient {
  /** Where this pod lives. */
  readonly kind: 'local' | 'remote'
  /**
   * The real pod ID on the target server (not the namespaced one the
   * sidebar uses). For local pods this is just the input `podId`; for
   * remote it's the `<realPodId>` portion of `remote:<registryId>:<…>`.
   */
  readonly realPodId: string
  /**
   * oRPC client pointed at the server that owns this pod. Use this for
   * every pod-related RPC — never the bare `orpc` import — so remote
   * pods route correctly.
   */
  readonly client: AppClient | null
  /** The paired-server registry id, `null` for local pods. */
  readonly registryId: string | null
  /**
   * `baseUrl` of the paired server (useful for WS subscriptions).
   * `null` for local pods (the renderer already holds a local WS).
   */
  readonly baseUrl: string | null
  /**
   * True while we're still resolving the remote session token / building
   * the paired client. Callers should treat their query results as
   * "loading" until this flips to false.
   */
  readonly isResolving: boolean
}

const REMOTE_PREFIX = 'remote:'

/**
 * Decode a namespaced pod id (`remote:<registryId>:<realPodId>`) back into
 * its parts. Returns `null` for local ids.
 */
export function parseRemotePodId(podId: string): { registryId: string; realPodId: string } | null {
  if (!podId.startsWith(REMOTE_PREFIX)) return null
  const rest = podId.slice(REMOTE_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) return null
  return { registryId: rest.slice(0, sep), realPodId: rest.slice(sep + 1) }
}

export function useActivePodClient(podId: string): ActivePodClient {
  const remote = useMemo(() => parseRemotePodId(podId), [podId])

  const { data: paired = [] } = useQuery({
    queryKey: ['servers:list'],
    queryFn: listPairedServers,
    staleTime: 30_000,
    enabled: !!remote,
  })

  const { data: sessionToken, isLoading: tokenLoading } = useQuery({
    queryKey: ['remote-session-token', remote?.registryId ?? ''],
    queryFn: async () => {
      if (!remote) return null
      return await getServerSessionToken(remote.registryId)
    },
    enabled: !!remote,
    staleTime: 30_000,
  })

  const remoteServer = useMemo(() => {
    if (!remote) return null
    return paired.find((s) => s.id === remote.registryId) ?? null
  }, [paired, remote])

  const remoteClient = useMemo<AppClient | null>(() => {
    if (!remote || !remoteServer || !sessionToken) return null
    const link = new RPCLink({
      url: remoteServer.baseUrl,
      headers: () => ({ authorization: `Bearer ${sessionToken}` }),
    })
    const raw = createORPCClient<AppClient>(link)
    // Every mutation fired through this client persists + replays via
    // the main-process outbox. Queries pass through. See
    // `src/shared/paired-client-outbox.ts`.
    return wrapPairedClientWithOutbox(raw, remote.registryId)
  }, [remote, remoteServer, sessionToken])

  if (!remote) {
    return {
      kind: 'local',
      realPodId: podId,
      client: orpcForPod(null),
      registryId: null,
      baseUrl: null,
      isResolving: false,
    }
  }

  return {
    kind: 'remote',
    realPodId: remote.realPodId,
    client: remoteClient,
    registryId: remote.registryId,
    baseUrl: remoteServer?.baseUrl ?? null,
    isResolving: tokenLoading || !remoteClient,
  }
}
