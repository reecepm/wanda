import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { orpcForPod, orpcUtils } from '@/shared/orpc'
import type { AppClient } from '../../../../shared/contracts'
import { useActivePodClient } from './use-active-pod-client'

export function usePodActions(podId: string, status: string, isTransitioning: boolean) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const active = useActivePodClient(podId)
  const isRemote = active.kind === 'remote'
  const realPodId = active.realPodId
  // Pod-namespace for local invalidation uses the sidebar's namespaced id
  // (so the sidebar refreshes correctly); per-server remote query keys use
  // `[remote, registryId, ...]` — same prefix usePodData writes with.
  const remotePrefix = useMemo(() => (isRemote ? ['remote', active.registryId!] : null), [isRemote, active.registryId])

  const prevStatus = useRef(status)
  useEffect(() => {
    if (status === 'failed' && prevStatus.current !== 'failed') {
      setError((current) => current ?? 'Pod failed to start — check logs for details')
    }
    prevStatus.current = status
  }, [status])

  // Auto-dismiss error after 8 seconds
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 8000)
    return () => clearTimeout(timer)
  }, [error])

  const setOptimisticStatus = useCallback(
    (newStatus: 'stopped' | 'running' | 'failed' | 'starting' | 'stopping') => {
      if (isRemote) {
        queryClient.setQueryData([...remotePrefix!, 'pod.getById', realPodId], (old: unknown) =>
          old && typeof old === 'object' ? { ...(old as Record<string, unknown>), status: newStatus } : old,
        )
        return
      }
      queryClient.setQueryData(orpcUtils.pod.getById.queryKey({ input: { id: realPodId } }), (old) =>
        old ? { ...old, status: newStatus } : old,
      )
    },
    [isRemote, queryClient, realPodId, remotePrefix],
  )

  const invalidatePod = useCallback(() => {
    if (isRemote) {
      // Paired servers own their own caches — invalidate the matching
      // remote-prefixed query keys so usePodData re-fetches.
      queryClient.invalidateQueries({ queryKey: [...remotePrefix!, 'pod.getById', realPodId] })
      queryClient.invalidateQueries({ queryKey: [...remotePrefix!, 'pod.runningTerminals', realPodId] })
      queryClient.invalidateQueries({ queryKey: [...remotePrefix!, 'pod.listTerminals', realPodId] })
      queryClient.invalidateQueries({ queryKey: [...remotePrefix!, 'podItem.list', realPodId] })
      queryClient.invalidateQueries({ queryKey: [...remotePrefix!, 'view.listByPod', realPodId] })
      queryClient.invalidateQueries({ queryKey: [...remotePrefix!, 'pod.listCommands', realPodId] })
      queryClient.invalidateQueries({ queryKey: [...remotePrefix!, 'pod.runningCommands', realPodId] })
      return
    }
    queryClient.invalidateQueries({ queryKey: orpcUtils.pod.getById.key({ input: { id: realPodId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.pod.runningTerminals.key({ input: { id: realPodId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.pod.listTerminals.key({ input: { podId: realPodId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.podItem.list.key({ input: { podId: realPodId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.view.listByPod.key({ input: { podId: realPodId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.pod.listCommands.key({ input: { podId: realPodId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.pod.runningCommands.key({ input: { podId: realPodId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.pod.listTags.key({ input: { podId: realPodId } }) })
  }, [queryClient, realPodId, isRemote, remotePrefix])

  /** Pick the pod client owned by whatever server this pod lives on. */
  const podTarget = useCallback((): AppClient['pod'] | null => {
    if (isRemote) return active.client?.pod ?? null
    return orpcForPod(null).pod
  }, [active.client, isRemote])

  const handleStart = useCallback(async () => {
    if (isTransitioning) return
    setError(null)
    setOptimisticStatus('starting')
    try {
      const target = podTarget()
      if (!target) throw new Error('remote client not ready')
      await target.start({ id: realPodId })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start pod')
    }
    invalidatePod()
  }, [realPodId, isTransitioning, setOptimisticStatus, podTarget, invalidatePod])

  const handleStop = useCallback(async () => {
    if (isTransitioning) return
    setError(null)
    setOptimisticStatus('stopping')
    try {
      const target = podTarget()
      if (!target) throw new Error('remote client not ready')
      await target.stop({ id: realPodId })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to stop pod')
    }
    invalidatePod()
  }, [realPodId, isTransitioning, setOptimisticStatus, podTarget, invalidatePod])

  const handleRestart = useCallback(async () => {
    if (isTransitioning) return
    setError(null)
    setOptimisticStatus('stopping')
    try {
      const target = podTarget()
      if (!target) throw new Error('remote client not ready')
      await target.restart({ id: realPodId })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to restart pod')
    }
    invalidatePod()
  }, [realPodId, isTransitioning, setOptimisticStatus, podTarget, invalidatePod])

  const handleOpenInEditor = useCallback(
    async (editorId: string) => {
      // Editor launching runs on the LOCAL machine (the user's laptop). For
      // a remote pod, the local editor opens an SSH-remote URL pointed at
      // the pod's host — the paired server would have no editor to open.
      // Until that flow is wired, fall back to the local server which can
      // at least report "no editor for remote pods".
      await orpcForPod(null).pod.openInEditor({ podId: realPodId, editor: editorId as 'zed' | 'vscode' | 'cursor' })
    },
    [realPodId],
  )

  return {
    error,
    invalidatePod,
    handleStart,
    handleStop,
    handleRestart,
    handleOpenInEditor,
  }
}
