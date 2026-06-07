import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  invalidateNotificationInboxQueries,
  useNotificationInboxInvalidation,
} from '@/features/notifications/hooks/use-notification-badges'
import { sortByPriority } from '@/features/notifications/utils/notification-utils'
import { orpcUtils } from '@/shared/orpc'
import { useUIStore } from '@/stores/ui-store'
import { Button } from '@/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/ui/drawer'
import { NotificationItem } from './notification-item'

type Tab = 'attention' | 'all' | 'done'

export function InboxPanel() {
  const inboxOpen = useUIStore((s) => s.inboxOpen)
  const setInboxOpen = useUIStore((s) => s.setInboxOpen)
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('attention')
  useNotificationInboxInvalidation()

  const { data: unresolvedRaw = [] } = useQuery({
    ...orpcUtils.notification.listUnresolved.queryOptions({ input: {} }),
    refetchInterval: 30_000,
  })

  const { data: recentRaw = [] } = useQuery({
    ...orpcUtils.notification.listRecent.queryOptions({ input: { limit: 100 } }),
    refetchInterval: 30_000,
    enabled: activeTab === 'all' || activeTab === 'done',
  })

  // Sort unresolved: blocking first, then urgent, then info; oldest-first within priority
  const attentionItems = useMemo(() => sortByPriority(unresolvedRaw), [unresolvedRaw])

  const doneItems = useMemo(() => recentRaw.filter((n) => n.resolvedAt), [recentRaw])

  function handleResolved() {
    invalidateNotificationInboxQueries(queryClient)
  }

  const dismissAllMutation = useMutation({
    ...orpcUtils.notification.dismissAll.mutationOptions(),
    onSuccess: handleResolved,
  })

  const items = activeTab === 'attention' ? attentionItems : activeTab === 'done' ? doneItems : recentRaw

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'attention', label: 'Attention', count: unresolvedRaw.length || undefined },
    { key: 'all', label: 'All' },
    { key: 'done', label: 'Done' },
  ]

  return (
    <Drawer direction="right" open={inboxOpen} onOpenChange={setInboxOpen}>
      <DrawerContent className="h-full w-80 sm:max-w-80">
        <DrawerHeader className="flex flex-row items-center justify-between px-3 py-1 h-8 border-b border-zinc-800">
          <DrawerTitle className="text-[10px] font-medium text-zinc-500">Inbox</DrawerTitle>
          {unresolvedRaw.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => dismissAllMutation.mutate({})}
              disabled={dismissAllMutation.isPending}
              className="h-5 px-1.5 text-[10px] text-zinc-500 hover:text-zinc-300"
            >
              Dismiss all
            </Button>
          )}
        </DrawerHeader>

        {/* Tab bar */}
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-zinc-800">
          {tabs.map((tab) => (
            <Button
              key={tab.key}
              type="button"
              variant={activeTab === tab.key ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setActiveTab(tab.key)}
              className={`h-6 px-2 text-[11px] ${
                activeTab === tab.key
                  ? 'bg-zinc-800 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
            >
              {tab.label}
              {tab.count ? (
                <span className="ml-1 text-[9px] bg-zinc-700 text-zinc-300 px-1 rounded-full">{tab.count}</span>
              ) : null}
            </Button>
          ))}
        </div>

        {/* Notification list */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-xs text-zinc-600">
              {activeTab === 'attention' ? 'No items need attention' : 'No notifications'}
            </div>
          ) : (
            items.map((notification) => (
              <NotificationItem key={notification.id} notification={notification} onResolved={handleResolved} />
            ))
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
