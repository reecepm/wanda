// Fan-out: pull a list-shaped resource from every paired server and merge.
//
// The hook itself (`useFanOutQuery`) wraps `useQueries` from TanStack
// Query — it depends on React, so it lives in the React file. The merge
// step is split out as a pure function so it's testable without React,
// and so other consumers (workers, batch updates, offline checks) can
// share the same logic.
//
// Items get a synthetic `serverId` field so callers can tell which server
// each item came from. Errors are surfaced per-server so the UI can show
// "Mac mini offline" without losing data from the others.

import { type UseQueryOptions, useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { AppClient } from '../../../shared/contracts'
import type { PairedServerView } from '../../../shared/contracts/servers'
import { createServerPool } from './server-pool'
import { getServerSessionToken, useServers } from './use-servers'

export type ServerQueryState<T> =
  | { serverId: string; state: 'pending' }
  | { serverId: string; state: 'success'; data: T[] }
  | { serverId: string; state: 'error'; error: Error }

export interface MergedFanOutResult<T> {
  /** Flat array of all items, each tagged with the originating serverId. */
  data: Array<T & { serverId: string }>
  /** True if at least one server is still loading. */
  isLoading: boolean
  /** Per-server errors (if any). */
  errors: Array<{ serverId: string; error: Error }>
  /** Server ids whose query errored — useful for showing offline badges. */
  offlineServerIds: string[]
}

/**
 * Pure merge step. Tested independently so we don't need to drive React
 * to verify combine logic.
 */
export function mergeFanOut<T>(states: ReadonlyArray<ServerQueryState<T>>): MergedFanOutResult<T> {
  const data: Array<T & { serverId: string }> = []
  const errors: Array<{ serverId: string; error: Error }> = []
  const offlineServerIds: string[] = []
  let isLoading = false

  for (const s of states) {
    if (s.state === 'pending') {
      isLoading = true
      continue
    }
    if (s.state === 'error') {
      errors.push({ serverId: s.serverId, error: s.error })
      offlineServerIds.push(s.serverId)
      continue
    }
    const items = s.data ?? []
    for (const item of items) {
      data.push({ ...item, serverId: s.serverId })
    }
  }

  return { data, isLoading, errors, offlineServerIds }
}

export const sharedPool = createServerPool({
  getSessionToken: getServerSessionToken,
})

/**
 * Run `query(client, server)` against every paired server in parallel and
 * merge the results. Cached per (queryKey, server.id, server.baseUrl).
 *
 * Example:
 *
 *   const { data: pods, offlineServerIds } = useFanOutQuery({
 *     keyPrefix: 'pods',
 *     query: (client) => client.pod.list({}),
 *   })
 */
export function useFanOutQuery<T>(opts: {
  /** Stable key fragment for this fan-out (e.g. 'pods'). */
  readonly keyPrefix: string
  /** Per-server query function. Receives the cached oRPC client + server descriptor. */
  readonly query: (client: AppClient, server: PairedServerView) => Promise<T[]>
  /** Optional UseQueryOptions overrides applied to every per-server query. */
  readonly queryOptions?: Partial<Omit<UseQueryOptions, 'queryKey' | 'queryFn'>>
}): MergedFanOutResult<T> {
  const { data: servers = [] } = useServers()
  const { keyPrefix, query, queryOptions } = opts

  const queries = useMemo(
    () =>
      servers.map((server) => ({
        queryKey: ['fan-out', keyPrefix, server.id, server.baseUrl],
        queryFn: async () => {
          const conn = await sharedPool.clientFor(server)
          return query(conn.client, server)
        },
        ...queryOptions,
      })),
    [servers, keyPrefix, query, queryOptions],
  )

  const results = useQueries({
    queries,
    combine: (rs) => {
      const states: ServerQueryState<T>[] = rs.map((r, i) => {
        const server = servers[i]!
        if (r.isLoading) return { serverId: server.id, state: 'pending' }
        if (r.isError) return { serverId: server.id, state: 'error', error: r.error as Error }
        return { serverId: server.id, state: 'success', data: (r.data as T[]) ?? [] }
      })
      return mergeFanOut(states)
    },
  })

  return results
}
