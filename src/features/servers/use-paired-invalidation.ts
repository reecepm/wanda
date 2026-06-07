// Paired-server query invalidation.
//
// Mirrors `useMcpInvalidation` for paired servers. The local hook listens
// to the local server's `orpc:invalidate` broadcasts; this hook does the
// same for every paired server the user has connected to. Without it,
// mutations on a paired server (or by another client of that server) are
// invisible to A's UI until polling tickles a refetch.
//
// The invalidation predicate matches every query keyed under
// `['remote', <registryId>, …]`, `['remote-ws-list', <registryId>, …]`,
// and `['remote-pod-list', <registryId>, …]` — the three shapes the
// renderer uses for paired-server-scoped queries today.

import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getPairedTerminalBridge } from './paired-terminal-bridge'
import { useServers } from './use-servers'

export function usePairedInvalidation() {
  const queryClient = useQueryClient()
  const { data: servers = [] } = useServers()

  useEffect(() => {
    if (servers.length === 0) return
    const cleanups: Array<() => void> = []

    for (const server of servers) {
      const registryId = server.id
      // Use a ref-style holder so cleanup sees the latest `off` even
      // if the bridge promise resolves AFTER cleanup fires. Without
      // this, a fast pair → unpair cycle would orphan the subscription
      // on the bridge forever and invalidations keep firing into a
      // queryClient that no longer matches anything for that server.
      const state: { cancelled: boolean; off: (() => void) | null } = { cancelled: false, off: null }

      void getPairedTerminalBridge(registryId)
        .then((bridge) => {
          const subscription = bridge.onInvalidate(() => {
            queryClient.invalidateQueries({
              predicate: (query) => {
                const key = query.queryKey
                if (!Array.isArray(key) || key.length < 2) return false
                const head = key[0]
                if (head !== 'remote' && head !== 'remote-ws-list' && head !== 'remote-pod-list') return false
                return key[1] === registryId
              },
            })
          })
          if (state.cancelled) {
            subscription()
            return
          }
          state.off = subscription
        })
        .catch((err) => {
          console.error('[paired-invalidation] bridge open failed', { registryId, err })
        })

      cleanups.push(() => {
        state.cancelled = true
        state.off?.()
      })
    }

    return () => {
      for (const c of cleanups) c()
    }
  }, [servers, queryClient])
}
