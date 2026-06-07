import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { POD_STATUS_COLORS } from '@/features/pod/utils/pod-status'
import type { PodItem } from '@/features/view'
import { orpcUtils } from '@/shared/orpc'
import type { TerminalConfig } from '@/types/terminal'
import { useActivePodClient } from './use-active-pod-client'

/**
 * Log remote-pod query failures exactly once per (podId, channel) pair.
 * A failed remote query otherwise holds `data === undefined` with no
 * user-facing signal; logging here turns the failure into a greppable
 * console entry.
 */
function useLogRemoteQueryFailure(
  channel: string,
  podId: string,
  isRemote: boolean,
  queryStatus: 'pending' | 'error' | 'success',
  error: Error | null | undefined,
): void {
  const loggedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isRemote) return
    if (queryStatus !== 'error') return
    const key = `${podId}:${channel}`
    if (loggedRef.current === key) return
    loggedRef.current = key
    console.error(
      `[pod-data] remote query failed: channel=${channel} podId=${podId} error=${error instanceof Error ? error.message : String(error)}`,
    )
  }, [channel, podId, isRemote, queryStatus, error])
}

// Fetch all the per-pod data the pod-page consumes, routing to whichever
// server owns the pod. For local pods this is the baked-in `orpc` /
// `orpcUtils` client; for remote (namespaced) pod ids it's a paired oRPC
// client constructed from the main-process server registry. The shape
// returned is identical either way so the rest of the pod page doesn't
// have to branch.

export function usePodData(podId: string, isTemplate?: boolean) {
  const active = useActivePodClient(podId)
  const realPodId = active.realPodId
  const remoteClient = active.kind === 'remote' ? active.client : null
  const isRemote = active.kind === 'remote'
  // While the remote session is resolving, disable queries so they don't
  // hammer an unready client.
  const ready = !isRemote || !!remoteClient

  // For local pods we keep going through `orpcUtils.*.queryOptions()` so
  // TanStack Query's cache key / invalidation machinery stays the same.
  // For remote pods we use a per-server cache-key prefix so the same pod
  // id on different servers doesn't cross-pollute caches.
  const remoteKeyPrefix = isRemote ? ['remote', active.registryId!] : null

  const podQuery = useQuery<
    unknown,
    Error,
    {
      id: string
      status?: string
      runtime?: { type?: string } | null
      workenvId?: string | null
      activeViewId?: string | null
      cwd?: string
    } | null
  >(
    isRemote
      ? {
          queryKey: [...remoteKeyPrefix!, 'pod.getById', realPodId] as const,
          queryFn: async () => {
            if (!remoteClient) return null
            return (await remoteClient.pod.getById({ id: realPodId })) as unknown
          },
          enabled: ready,
          staleTime: 5_000,
        }
      : orpcUtils.pod.getById.queryOptions({ input: { id: realPodId } }),
  )
  const pod = podQuery.data
  useLogRemoteQueryFailure('pod.getById', realPodId, isRemote, podQuery.status, podQuery.error)
  const status = (pod?.status ?? 'stopped') as keyof typeof POD_STATUS_COLORS
  const isTransitioning = status === 'starting' || status === 'stopping'
  const rt = pod?.runtime
  const runtimeType = rt && typeof rt === 'object' && 'type' in rt ? (rt as { type: string }).type : undefined
  const podIsLocalPty = pod && runtimeType !== 'docker'

  const terminalConfigsQuery = useQuery(
    isRemote
      ? {
          queryKey: [...remoteKeyPrefix!, 'pod.listTerminals', realPodId] as const,
          queryFn: async () => {
            if (!remoteClient) return []
            return (await remoteClient.pod.listTerminals({ podId: realPodId })) as TerminalConfig[]
          },
          enabled: ready,
        }
      : orpcUtils.pod.listTerminals.queryOptions({ input: { podId: realPodId } }),
  )
  const terminalConfigs = (terminalConfigsQuery.data ?? []) as TerminalConfig[]
  const terminalConfigsStatus = terminalConfigsQuery.status
  useLogRemoteQueryFailure(
    'pod.listTerminals',
    realPodId,
    isRemote,
    terminalConfigsQuery.status,
    terminalConfigsQuery.error,
  )

  const { data: runningTerminals = [] } = useQuery(
    isRemote
      ? {
          queryKey: [...remoteKeyPrefix!, 'pod.runningTerminals', realPodId] as const,
          queryFn: async () => {
            if (!remoteClient) return []
            return await remoteClient.pod.runningTerminals({ id: realPodId })
          },
          enabled: ready && !isTemplate,
          refetchInterval: status === 'running' && !isTemplate ? 2000 : false,
        }
      : {
          ...orpcUtils.pod.runningTerminals.queryOptions({ input: { id: realPodId } }),
          refetchInterval: status === 'running' && !isTemplate ? 2000 : false,
          enabled: !isTemplate,
        },
  )

  const { data: commandConfigs = [] } = useQuery(
    isRemote
      ? {
          queryKey: [...remoteKeyPrefix!, 'pod.listCommands', realPodId] as const,
          queryFn: async () => {
            if (!remoteClient) return []
            return await remoteClient.pod.listCommands({ podId: realPodId })
          },
          enabled: ready,
        }
      : orpcUtils.pod.listCommands.queryOptions({ input: { podId: realPodId } }),
  )
  const { data: runningCommands = [] } = useQuery(
    isRemote
      ? {
          queryKey: [...remoteKeyPrefix!, 'pod.runningCommands', realPodId] as const,
          queryFn: async () => {
            if (!remoteClient) return []
            return await remoteClient.pod.runningCommands({ podId: realPodId })
          },
          enabled: ready && !isTemplate,
          refetchInterval: status === 'running' && !isTemplate ? 2000 : false,
        }
      : {
          ...orpcUtils.pod.runningCommands.queryOptions({ input: { podId: realPodId } }),
          refetchInterval: status === 'running' && !isTemplate ? 2000 : false,
          enabled: !isTemplate,
        },
  )

  const podItemsQuery = useQuery(
    isRemote
      ? {
          queryKey: [...remoteKeyPrefix!, 'podItem.list', realPodId] as const,
          queryFn: async () => {
            if (!remoteClient) return []
            return await remoteClient.podItem.list({ podId: realPodId })
          },
          enabled: ready,
        }
      : orpcUtils.podItem.list.queryOptions({ input: { podId: realPodId } }),
  )
  const podItemsList = (podItemsQuery.data ?? []) as PodItem[]
  const podItemsStatus = podItemsQuery.status
  useLogRemoteQueryFailure('podItem.list', realPodId, isRemote, podItemsQuery.status, podItemsQuery.error)

  const podViewsQuery = useQuery(
    isRemote
      ? {
          queryKey: [...remoteKeyPrefix!, 'view.listByPod', realPodId] as const,
          queryFn: async () => {
            if (!remoteClient) return []
            return await remoteClient.view.listByPod({ podId: realPodId })
          },
          enabled: ready,
        }
      : orpcUtils.view.listByPod.queryOptions({ input: { podId: realPodId } }),
  )
  const podViews = podViewsQuery.data
  useLogRemoteQueryFailure('view.listByPod', realPodId, isRemote, podViewsQuery.status, podViewsQuery.error)

  // Editors come from the LOCAL machine — we open editors on the user's
  // laptop, not on the remote. Keep this as the plain local query.
  const { data: detectedEditors = [] } = useQuery({
    ...orpcUtils.pod.detectEditors.queryOptions({}),
    staleTime: 60_000,
  })

  const { data: defaultEditorSetting } = useQuery(
    orpcUtils.settings.get.queryOptions({ input: { key: 'editor.default' } }),
  )

  const defaultEditor = detectedEditors.find((e) => e.id === defaultEditorSetting) ?? detectedEditors[0] ?? null

  return {
    pod,
    status,
    isTransitioning,
    runtimeType,
    podIsLocalPty,
    terminalConfigs,
    terminalConfigsStatus,
    runningTerminals,
    commandConfigs,
    runningCommands,
    podItemsList,
    podItemsStatus,
    podViews,
    detectedEditors,
    defaultEditor,
    // Routing metadata so child hooks / components can branch on remote.
    active,
  }
}
