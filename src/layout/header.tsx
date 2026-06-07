import { useNotificationBadges } from '@/features/notifications'
import { RiNotification3Fill, RiNotification3Line, RiTerminalLine } from '@/lib/icons'
import { cn } from '@/shared/utils'
import { useUIStore } from '@/stores/ui-store'

export function SidebarHeader() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)

  if (sidebarCollapsed) {
    // Narrow: just the icon centered in the nav column
    return (
      <div className="h-9 w-12 flex items-center justify-center drag-region shrink-0">
        <RiTerminalLine className="h-3.5 w-3.5 text-zinc-500" />
      </div>
    )
  }

  // Expanded: traffic-light padding + branding, spanning nav + sidebar width
  return (
    <div className="h-9 flex items-center justify-between border-b border-border bg-background px-3 drag-region shrink-0">
      <div className="flex items-center gap-1.5 pl-[4.5rem]">
        <RiTerminalLine className="h-3.5 w-3.5 text-zinc-400" />
        <span className="text-xs font-semibold text-zinc-200 tracking-tight">Wanda</span>
      </div>
      <InboxButton />
    </div>
  )
}

function InboxButton() {
  const inboxOpen = useUIStore((s) => s.inboxOpen)
  const setInboxOpen = useUIStore((s) => s.setInboxOpen)
  const counts = useNotificationBadges()
  const Icon = inboxOpen ? RiNotification3Fill : RiNotification3Line
  const badgeCount = counts?.totalBlocking || counts?.totalUrgent || 0
  const badgeColor = counts?.totalBlocking ? 'bg-red-500' : 'bg-orange-400'

  return (
    <button
      type="button"
      aria-label={badgeCount > 0 ? `Notifications (${badgeCount} unread)` : 'Notifications'}
      aria-pressed={inboxOpen}
      onClick={() => setInboxOpen(!inboxOpen)}
      className={cn(
        'no-drag relative flex items-center justify-center size-6 rounded-md transition-colors',
        inboxOpen ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50',
      )}
    >
      <Icon className="size-3.5" />
      {badgeCount > 0 && (
        <span
          className={cn(
            'absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full text-[9px] font-medium text-white flex items-center justify-center',
            badgeColor,
          )}
        >
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      )}
    </button>
  )
}
