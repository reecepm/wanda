import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useNotificationUnresolvedInvalidation } from '@/features/notifications'
import { orpcUtils } from '@/shared/orpc'

/**
 * Drives the attention mode queue: an ordered list of unresolved notifications
 * with blocking or urgent priority. Notification emission and resolution live
 * in the main process; this hook is a read-side projection that the toggle
 * button (for the badge count) and the auto-nav hook both consume.
 */
export function useAttentionQueue() {
  const { data } = useQuery({
    ...orpcUtils.notification.listUnresolved.queryOptions({ input: {} }),
    refetchInterval: 30_000,
  })
  useNotificationUnresolvedInvalidation()

  // Filter to items that should force the user's attention: blocking or urgent,
  // ordered by creation time (the server already returns them sorted ascending).
  const queue = useMemo(() => {
    if (!data) return []
    return data.filter((n: { priority: string }) => n.priority === 'blocking' || n.priority === 'urgent')
  }, [data])

  return queue
}
