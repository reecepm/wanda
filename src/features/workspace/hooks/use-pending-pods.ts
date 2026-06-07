import { useCallback, useRef, useState } from 'react'
import { useAnyWorkenvBootstrapProgress } from '@/features/workenv'
import type { PodSummary } from '@/features/workspace/components/workspace-list'

export type PendingPod = {
  id: string
  workspaceId: string
  name: string
  label: string
  status: PodSummary['status']
  hasWorktree?: boolean
  phase: 'creating' | 'deleting'
}

type PendingPodPatch = Partial<{
  id: string
  workspaceId: string
  name: string
  label: string
  status: PodSummary['status']
  hasWorktree: boolean
  phase: 'creating' | 'deleting'
}>

export type PendingPodsApi = {
  pendingPods: Record<string, PendingPod>
  pendingByWorkenvIdRef: React.RefObject<Map<string, string>>
  updatePendingPod: (id: string, patch: PendingPodPatch) => void
  beginPendingPod: (workspaceId: string, name: string, label: string, hasWorktree?: boolean) => string
  beginExistingPodProgress: (
    id: string,
    workspaceId: string,
    name: string,
    label: string,
    status?: PodSummary['status'],
    hasWorktree?: boolean,
  ) => void
  clearPendingPod: (id: string) => void
  finishPendingPod: (id: string, label?: string) => void
  failPendingPod: (id: string, label: string) => void
}

/**
 * Owns the optimistic pending-pod state machine that drives sidebar create /
 * delete progress. Subscribes to workenv bootstrap progress so each setup step
 * surfaces as live label text on the pending row.
 */
export function usePendingPods(): PendingPodsApi {
  const [pendingPods, setPendingPods] = useState<Record<string, PendingPod>>({})
  const pendingByWorkenvIdRef = useRef<Map<string, string>>(new Map())

  const updatePendingPod = useCallback((id: string, patch: PendingPodPatch) => {
    setPendingPods((prev) => {
      const current = prev[id]
      if (!current) return prev
      const next = { ...current, ...patch }
      if (patch.id && patch.id !== id) {
        const { [id]: _old, ...rest } = prev
        return { ...rest, [patch.id]: next }
      }
      return { ...prev, [id]: next }
    })
  }, [])

  const beginPendingPod = useCallback((workspaceId: string, name: string, label: string, hasWorktree?: boolean) => {
    const id = `pending:${workspaceId}:${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`
    setPendingPods((prev) => ({
      ...prev,
      [id]: { id, workspaceId, name, label, status: 'starting', hasWorktree, phase: 'creating' },
    }))
    return id
  }, [])

  const beginExistingPodProgress = useCallback(
    (
      id: string,
      workspaceId: string,
      name: string,
      label: string,
      status: PodSummary['status'] = 'starting',
      hasWorktree?: boolean,
    ) => {
      setPendingPods((prev) => ({
        ...prev,
        [id]: { id, workspaceId, name, label, status, hasWorktree, phase: 'deleting' },
      }))
    },
    [],
  )

  const clearPendingPod = useCallback((id: string) => {
    setPendingPods((prev) => {
      const { [id]: _removed, ...rest } = prev
      return rest
    })
  }, [])

  const finishPendingPod = useCallback(
    (id: string, label = 'Ready') => {
      updatePendingPod(id, { label, status: 'running' })
      window.setTimeout(() => {
        setPendingPods((prev) => {
          const { [id]: _done, ...rest } = prev
          return rest
        })
      }, 1200)
    },
    [updatePendingPod],
  )

  const failPendingPod = useCallback(
    (id: string, label: string) => {
      updatePendingPod(id, { label, status: 'failed' })
    },
    [updatePendingPod],
  )

  useAnyWorkenvBootstrapProgress(
    useCallback(
      (workenvId: string, index: number, stepName: string, status: 'started' | 'succeeded' | 'failed') => {
        const pendingId = pendingByWorkenvIdRef.current.get(workenvId)
        if (!pendingId) return
        const shortName = stepName.replace(/^shell:\s*/, '').slice(0, 72)
        updatePendingPod(pendingId, {
          label:
            status === 'started'
              ? `Environment setup ${index + 1}: ${shortName}`
              : status === 'succeeded'
                ? `Completed setup ${index + 1}`
                : `Setup failed: ${shortName}`,
          status: status === 'failed' ? 'failed' : 'starting',
        })
      },
      [updatePendingPod],
    ),
  )

  return {
    pendingPods,
    pendingByWorkenvIdRef,
    updatePendingPod,
    beginPendingPod,
    beginExistingPodProgress,
    clearPendingPod,
    finishPendingPod,
    failPendingPod,
  }
}
