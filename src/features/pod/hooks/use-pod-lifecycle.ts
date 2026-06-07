import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { type DBView, type PodItem, useViewStore } from '@/features/view'
import { onPodRecovered, onPodStatusChange } from '@/shared/app-bridge'
import { orpcForPod, orpcUtils } from '@/shared/orpc'
import { useUIStore } from '@/stores/ui-store'
import type { CommandItemConfig, TerminalItemConfig } from '@/types/schema'
import type { ActivePodClient } from './use-active-pod-client'

type PodRecoveryInfo = { recovered: number; failed: number; wasDirty: boolean }

interface PodLifecycleArgs {
  podId: string
  isTemplate?: boolean
  pod:
    | {
        id?: string
        status?: string
        runtime?: { type?: string } | null
        activeViewId?: string | null
        cwd?: string
      }
    | null
    | undefined
  terminalConfigs: { id: string }[]
  terminalConfigsStatus: string
  commandConfigs: { id: string }[]
  podItemsList: PodItem[]
  podItemsStatus: 'pending' | 'error' | 'success'
  podViews: DBView[] | undefined
  invalidatePod: () => void
  /** Provided by usePodData; routes lifecycle calls to the right server. */
  active?: ActivePodClient
}

export function usePodLifecycle({
  podId,
  isTemplate,
  pod,
  terminalConfigs,
  terminalConfigsStatus,
  commandConfigs,
  podItemsList,
  podItemsStatus,
  podViews,
  invalidatePod,
  active,
}: PodLifecycleArgs) {
  const queryClient = useQueryClient()
  const { setActivePodId } = useUIStore()
  const isRemote = active?.kind === 'remote'
  const realPodId = active?.realPodId ?? podId
  const loadedForPodRef = useRef<string | null>(null)
  const invalidatedMissingRef = useRef<string | null>(null)
  const autoStartedRef = useRef<string | null>(null)

  useEffect(() => {
    const state = useViewStore.getState()
    if (state.activeEntityId !== podId && state.entities[podId]) {
      useViewStore.setState({ activeEntityId: podId })
    }
  }, [podId])

  // setActivePodId also clears activeWorkspaceViewId via the store.
  useEffect(() => {
    if (!isTemplate) setActivePodId(podId)
    return () => {
      loadedForPodRef.current = null
    }
  }, [podId, isTemplate, setActivePodId])

  // Auto-start the pod when its view mounts. Covers both local PTY pods and
  // container-backed pods — server's `ensureStarted` is idempotent, so it's
  // safe to fire for either kind. We used to preempt this via a splash-time
  // `ensureAllLocalStarted`, but that stampeded heavy agent processes (claude
  // etc. peak ~2GB RSS during init); lazy-on-view is the sustainable pattern.
  useEffect(() => {
    if (isTemplate) return
    if (!pod) return
    if (terminalConfigs.length === 0) return
    if (autoStartedRef.current === podId) return
    // For local pods, only auto-start when the pod is stopped/failed —
    // we trust the local db's status. For remote pods we can't trust
    // the status: a remote Wanda that restarted will have db rows
    // marked "running" but no actual PTYs alive in memory, so fire
    // `ensureStarted` unconditionally. It's idempotent on the server.
    if (!isRemote && pod.status !== 'stopped' && pod.status !== 'failed') return
    autoStartedRef.current = podId
    const target = isRemote ? active?.client?.pod : orpcForPod(null).pod
    if (!target) return
    target
      .ensureStarted({ id: realPodId })
      .then(() => invalidatePod())
      .catch((err) => {
        console.error('[pod] ensureStarted failed', { podId, isRemote, err })
      })
  }, [
    podId,
    pod,
    pod?.status,
    terminalConfigs.length,
    isRemote,
    realPodId,
    isTemplate,
    active?.client?.pod,
    invalidatePod,
  ])

  useEffect(() => {
    if (loadedForPodRef.current === podId) return
    if (podViews === undefined) return
    if (terminalConfigsStatus !== 'success') return
    if (podItemsStatus !== 'success') return

    const validTerminalIds = new Set(terminalConfigs.map((t) => t.id))
    const validCommandIds = new Set(commandConfigs.map((c) => c.id))
    const filteredPodItems = podItemsList.filter((pi) => {
      if (pi.contentType === 'terminal' || pi.contentType === 'agent')
        return validTerminalIds.has((pi.config as TerminalItemConfig).podTerminalId)
      if (pi.contentType === 'command') return validCommandIds.has((pi.config as CommandItemConfig).podCommandId)
      return true
    })
    useViewStore.getState().load(podId, podViews, filteredPodItems, pod?.activeViewId ?? null)
    loadedForPodRef.current = podId
  }, [
    podItemsStatus,
    podViews,
    terminalConfigsStatus,
    podId,
    terminalConfigs,
    commandConfigs,
    podItemsList,
    pod?.activeViewId,
  ])

  // Reconcile view configs from server on refetch. Without this, a
  // canvas / columns / split-pane layout change driven by another
  // client (via push invalidation on the paired server) never shows up
  // locally — `load` is a one-shot, so the per-view layout frozen at
  // first-mount wins even after the server's config has moved on.
  // Fires on every podViews reference change (TanStack Query returns
  // a fresh array on refetch), which means every invalidation cycle.
  useEffect(() => {
    if (loadedForPodRef.current !== podId) return
    if (podViews === undefined) return
    useViewStore.getState().reconcileViewsFromServer(podId, podViews)
  }, [podViews, podId])

  // Reconcile views when configs change
  useEffect(() => {
    if (loadedForPodRef.current !== podId) return
    if (terminalConfigs.length === 0 && podItemsList.length === 0) return
    const validTerminalIds = new Set(terminalConfigs.map((t) => t.id))

    const storeState = useViewStore.getState()
    const storePod = storeState.activeEntityId ? storeState.entities[storeState.activeEntityId] : undefined
    const storeItems = storePod?.podItems ?? []
    const mergedMap = new Map(storeItems.map((pi) => [pi.id, pi]))
    for (const pi of podItemsList) {
      mergedMap.set(pi.id, pi)
    }

    const validCommandIds = new Set(commandConfigs.map((c) => c.id))

    const validItems = [...mergedMap.values()].filter((pi) => {
      if (pi.contentType === 'terminal' || pi.contentType === 'agent')
        return validTerminalIds.has((pi.config as TerminalItemConfig).podTerminalId)
      if (pi.contentType === 'command') return validCommandIds.has((pi.config as CommandItemConfig).podCommandId)
      return true
    })

    const coveredTerminalIds = new Set(
      validItems
        .filter((pi) => pi.contentType === 'terminal')
        .map((pi) => (pi.config as TerminalItemConfig).podTerminalId),
    )
    const missingIds = terminalConfigs.filter((t) => !coveredTerminalIds.has(t.id)).map((t) => t.id)
    const missingKey = missingIds.join(',')
    if (missingIds.length > 0 && missingKey !== invalidatedMissingRef.current) {
      invalidatedMissingRef.current = missingKey
      queryClient.invalidateQueries({ queryKey: orpcUtils.podItem.list.key({ input: { podId } }) })
    } else if (missingIds.length === 0) {
      invalidatedMissingRef.current = null
    }

    if (validItems.length > 0) {
      useViewStore.getState().reconcile(validItems)
    }
  }, [terminalConfigs, commandConfigs, podItemsList, podId, queryClient])

  // Listen for pod status changes. For remote pods these broadcasts fire
  // on the paired server's /events channel — not the local WS this
  // subscribes to, so remote pod status is refreshed via the
  // `refetchInterval` poller on `pod.runningTerminals`.
  useEffect(() => {
    if (isRemote) return
    const removeListener = onPodStatusChange((id) => {
      if (id === podId) invalidatePod()
    })
    return () => {
      removeListener()
    }
  }, [podId, isRemote, invalidatePod])
}

export function usePodRecoveryInfo(onRecovered: (info: PodRecoveryInfo) => void) {
  const onRecoveredRef = useRef(onRecovered)

  useEffect(() => {
    onRecoveredRef.current = onRecovered
  }, [onRecovered])

  useEffect(() => {
    const cleanup = onPodRecovered((info) => {
      onRecoveredRef.current(info)
    })
    return () => {
      cleanup()
    }
  }, [])
}

export function usePodStatusChange(onStatusChange: (podId: string) => void) {
  const onStatusChangeRef = useRef(onStatusChange)

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    const removeListener = onPodStatusChange((id) => {
      onStatusChangeRef.current(id)
    })
    return () => {
      removeListener()
    }
  }, [])
}

/**
 * Invalidate ONLY the queries that belong to the one pod whose status
 * changed. `usePodStatusChange` forwards the changed `podId` to its
 * callback, so subscribers should funnel that id through here instead of
 * blasting the whole `['pod']` namespace (or every workspace's `pod.list`)
 * on every status tick — that refetches unrelated pods needlessly.
 */
export function invalidatePodQueries(queryClient: QueryClient, podId: string) {
  queryClient.invalidateQueries({ queryKey: orpcUtils.pod.getById.key({ input: { id: podId } }) })
  queryClient.invalidateQueries({ queryKey: orpcUtils.pod.runningTerminals.key({ input: { id: podId } }) })
  queryClient.invalidateQueries({ queryKey: orpcUtils.pod.runningCommands.key({ input: { podId } }) })
}
