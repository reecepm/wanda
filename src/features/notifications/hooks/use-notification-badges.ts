import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { onNotificationChanged } from '@/shared/app-bridge'
import { orpcUtils } from '@/shared/orpc'

export type PriorityCounts = { blocking: number; urgent: number; info: number }

export interface UnresolvedCounts {
  byPod: Record<string, PriorityCounts>
  byWorkspace: Record<string, PriorityCounts>
  global: PriorityCounts
  totalBlocking: number
  totalUrgent: number
}

export function invalidateNotificationInboxQueries(queryClient: QueryClient) {
  invalidateNotificationUnresolvedQueries(queryClient)
  queryClient.invalidateQueries({
    queryKey: orpcUtils.notification.listRecent.key({ input: { limit: 100 } }),
  })
  queryClient.invalidateQueries({
    queryKey: orpcUtils.notification.unresolvedCounts.key({ input: {} }),
  })
}

export function invalidateNotificationUnresolvedQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    queryKey: orpcUtils.notification.listUnresolved.key({ input: {} }),
  })
}

export function useNotificationInboxInvalidation() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const cleanup = onNotificationChanged(() => {
      invalidateNotificationInboxQueries(queryClient)
    })
    return () => {
      cleanup()
    }
  }, [queryClient])
}

export function useNotificationChanged(onChanged: () => void) {
  const onChangedRef = useRef(onChanged)

  useEffect(() => {
    onChangedRef.current = onChanged
  }, [onChanged])

  useEffect(() => {
    const cleanup = onNotificationChanged(() => {
      onChangedRef.current()
    })
    return () => {
      cleanup()
    }
  }, [])
}

export function useNotificationUnresolvedInvalidation() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const cleanup = onNotificationChanged(() => {
      invalidateNotificationUnresolvedQueries(queryClient)
    })
    return () => {
      cleanup()
    }
  }, [queryClient])
}

export function useNotificationBadges() {
  const queryClient = useQueryClient()

  const { data: counts } = useQuery({
    ...orpcUtils.notification.unresolvedCounts.queryOptions({ input: {} }),
    refetchInterval: 30_000,
  })

  // Listen for notifications:changed IPC → invalidate query
  useEffect(() => {
    const cleanup = onNotificationChanged(() => {
      queryClient.invalidateQueries({
        queryKey: orpcUtils.notification.unresolvedCounts.key({ input: {} }),
      })
    })
    return () => {
      cleanup()
    }
  }, [queryClient])

  return (counts as UnresolvedCounts) ?? null
}

export function highestPriority(counts?: PriorityCounts | null): 'blocking' | 'urgent' | null {
  if (!counts) return null
  if (counts.blocking > 0) return 'blocking'
  if (counts.urgent > 0) return 'urgent'
  return null
}
