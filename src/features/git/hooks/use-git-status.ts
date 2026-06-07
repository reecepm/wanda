import { type QueryClient, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { onGitStatusChange, watchGitRepoPath } from '@/shared/app-bridge'
import { orpcUtils } from '@/shared/orpc'
import type { GitStatus, GitStatusEvent } from '../../../../shared/contracts'

// useGitStatus — subscribe to unified git status for a single pod.
//
// The server maintains one canonical `GitStatus` per pod and pushes
// `GitStatusEvent`s over the `git:status` WebSocket channel. This hook:
//
//   1. Installs a single process-wide event listener (once per app) that
//      fans events into the TanStack Query cache keyed by `['git', 'status', podId]`.
//   2. On mount, calls `git.status.subscribe(podId)` to seed the cache and
//      start the server-side remote poller (reference-counted per pod).
//   3. On unmount of the LAST reader for a pod, calls
//      `git.status.unsubscribe(podId)` so the server can release resources.
//
// There is no `refetchInterval` / `staleTime` — the server is the source of
// truth and pushes updates proactively.

const QUERY_KEY_ROOT = ['git', 'status'] as const

export function watchGitRepo(repoPath: string): void {
  watchGitRepoPath(repoPath)
}

function queryKeyFor(podId: string) {
  return [...QUERY_KEY_ROOT, podId] as const
}

// Ref-counted client-side subscription tracker. Multiple components watching
// the same pod only produce one server-side subscribe/unsubscribe pair.
const clientSubRefCounts = new Map<string, number>()

// One shared listener installed the first time any component calls
// useGitStatus. Needs access to a QueryClient, which we capture lazily.
let listenerInstalled = false
let capturedQueryClient: QueryClient | null = null

function ensureListener(queryClient: QueryClient) {
  capturedQueryClient = queryClient
  if (listenerInstalled) return
  listenerInstalled = true

  onGitStatusChange((event: GitStatusEvent) => {
    const qc = capturedQueryClient
    if (!qc) return
    if (event.kind === 'snapshot') {
      qc.setQueryData(queryKeyFor(event.status.podId), event.status)
    } else if (event.kind === 'localUpdated') {
      qc.setQueryData<GitStatus>(queryKeyFor(event.podId), (prev) => (prev ? { ...prev, local: event.local } : prev))
    } else if (event.kind === 'remoteUpdated') {
      qc.setQueryData<GitStatus>(queryKeyFor(event.podId), (prev) => (prev ? { ...prev, remote: event.remote } : prev))
    } else if (event.kind === 'stackUpdated') {
      qc.setQueryData<GitStatus>(queryKeyFor(event.podId), (prev) => (prev ? { ...prev, stack: event.stack } : prev))
    }
  })
}

export interface UseGitStatusResult {
  status: GitStatus | null
  isLoading: boolean
  refresh: () => Promise<void>
}

function clientSubscribe(
  podId: string,
  queryClient: QueryClient,
  onStarted?: () => void,
  onSettled?: () => void,
): () => void {
  const next = (clientSubRefCounts.get(podId) ?? 0) + 1
  clientSubRefCounts.set(podId, next)

  if (next === 1) {
    onStarted?.()
    void orpcUtils.git.status.subscribe
      .call({ podId })
      .then((snapshot) => {
        if (snapshot) queryClient.setQueryData(queryKeyFor(podId), snapshot)
      })
      .catch((err) => {
        console.warn('[git-status] subscribe failed:', { podId, err })
      })
      .finally(() => onSettled?.())
  } else {
    onSettled?.()
  }

  return () => {
    const current = clientSubRefCounts.get(podId) ?? 0
    const after = current - 1
    if (after <= 0) {
      clientSubRefCounts.delete(podId)
      void orpcUtils.git.status.unsubscribe.call({ podId }).catch((err) => {
        console.warn('[git-status] unsubscribe failed:', { podId, err })
      })
    } else {
      clientSubRefCounts.set(podId, after)
    }
  }
}

export function useGitStatus(podId: string | null | undefined): UseGitStatusResult {
  const queryClient = useQueryClient()
  ensureListener(queryClient)
  const [subscribing, setSubscribing] = useState(false)

  const { data, isLoading } = useQuery<GitStatus | null>({
    queryKey: podId ? queryKeyFor(podId) : ['git', 'status', 'disabled'],
    queryFn: async () => {
      if (!podId) return null
      return queryClient.getQueryData<GitStatus>(queryKeyFor(podId)) ?? null
    },
    enabled: !!podId,
    // Server pushes updates — we don't need any polling or staleness.
    staleTime: Infinity,
    gcTime: Infinity,
  })

  useEffect(() => {
    if (!podId) return
    let active = true
    const unsubscribe = clientSubscribe(
      podId,
      queryClient,
      () => {
        if (active) setSubscribing(true)
      },
      () => {
        if (active) setSubscribing(false)
      },
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [podId, queryClient])

  return {
    status: data ?? null,
    isLoading: isLoading || subscribing,
    refresh: async () => {
      if (!podId) return
      await orpcUtils.git.status.refresh.call({ podId })
    },
  }
}

/**
 * Subscribe to git status for a dynamic set of pods (e.g. the tray's list of
 * running pods). Adds/removes server-side subscriptions as the id list
 * changes. Returns a `Map<podId, GitStatus>` of everything that's loaded —
 * pods still waiting on their first snapshot are simply absent from the map.
 */
export function useGitStatusMulti(podIds: string[]): Map<string, GitStatus> {
  const queryClient = useQueryClient()
  ensureListener(queryClient)
  const podIdsKey = podIds.join('\u0000')

  useEffect(() => {
    if (!podIdsKey) return
    const cleanups = podIdsKey.split('\u0000').map((id) => clientSubscribe(id, queryClient))
    return () => {
      for (const cleanup of cleanups) cleanup()
    }
  }, [podIdsKey, queryClient])

  const results = useQueries({
    queries: podIds.map((podId) => ({
      queryKey: queryKeyFor(podId),
      queryFn: async () => {
        return queryClient.getQueryData<GitStatus>(queryKeyFor(podId)) ?? null
      },
      staleTime: Infinity,
      gcTime: Infinity,
    })),
  })

  const map = new Map<string, GitStatus>()
  podIds.forEach((podId, i) => {
    const data = results[i]?.data as GitStatus | null | undefined
    if (data) map.set(podId, data)
  })
  return map
}
