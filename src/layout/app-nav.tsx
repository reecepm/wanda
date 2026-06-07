import { Link, useRouterState } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { useAttentionQueue } from '@/features/attention-mode'
import { useNotificationBadges } from '@/features/notifications'
import type { RemixiconComponentType } from '@/lib/icons'
import {
  RiBookFill,
  RiBookLine,
  RiFocus3Fill,
  RiFocus3Line,
  RiHome5Fill,
  RiHome5Line,
  RiListCheck3,
  RiNotification3Fill,
  RiNotification3Line,
  RiSettings3Fill,
  RiSettings3Line,
} from '@/lib/icons'
import { cn } from '@/shared/utils'
import { useUIStore } from '@/stores/ui-store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

interface NavItem {
  icon: RemixiconComponentType
  activeIcon: RemixiconComponentType
  label: string
  to: string
  match: (pathname: string) => boolean
}

const topItems: NavItem[] = [
  {
    icon: RiHome5Line,
    activeIcon: RiHome5Fill,
    label: 'Home',
    to: '/',
    match: (p) => p === '/' || p.startsWith('/pods'),
  },
  {
    icon: RiBookLine,
    activeIcon: RiBookFill,
    label: 'Plans',
    to: '/plans',
    match: (p) => p.startsWith('/plans'),
  },
  {
    icon: RiListCheck3,
    activeIcon: RiListCheck3,
    label: 'Tasks',
    to: '/tasks',
    match: (p) => p.startsWith('/tasks'),
  },
]

const bottomItems: NavItem[] = [
  {
    icon: RiSettings3Line,
    activeIcon: RiSettings3Fill,
    label: 'Settings',
    to: '/settings',
    match: (p) => p.startsWith('/settings'),
  },
]

type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

// Eased width/opacity transition tuned to feel like the iOS-style tab pill:
// the active button expands as the previous one shrinks, with the label
// crossfading slightly behind the size change so text never overflows the pill.
const PILL_TRANSITION = { duration: 0.24, ease: [0.32, 0.72, 0, 1] as const }
const LABEL_TRANSITION = { duration: 0.16, ease: 'easeOut' as const }

function NavPill({
  item,
  active,
  statusDot,
  tooltipSide,
}: {
  item: NavItem
  active: boolean
  statusDot?: 'connected' | 'disconnected'
  tooltipSide: TooltipSide
}) {
  const Icon = active ? item.activeIcon : item.icon
  const link = (
    <Link
      to={item.to}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-7 items-center rounded-full overflow-hidden transition-colors',
        active
          ? 'bg-white/[0.07] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50',
      )}
    />
  )
  const contents = (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center">
        <Icon className="size-4" />
      </span>
      <AnimatePresence initial={false}>
        {active && (
          <motion.span
            key="label"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ width: PILL_TRANSITION, opacity: LABEL_TRANSITION }}
            className="overflow-hidden"
          >
            <span className="block whitespace-nowrap pr-2.5 text-[12px] font-medium leading-none">{item.label}</span>
          </motion.span>
        )}
      </AnimatePresence>
      {statusDot && (
        <span
          className={cn(
            'absolute top-1 right-1 size-1.5 rounded-full',
            statusDot === 'connected' ? 'bg-emerald-500' : 'bg-zinc-600',
          )}
        />
      )}
    </>
  )

  return (
    <Tooltip open={active ? false : undefined}>
      <TooltipTrigger render={link}>{contents}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>{item.label}</TooltipContent>
    </Tooltip>
  )
}

function AttentionModeNavButton({ tooltipSide }: { tooltipSide: TooltipSide }) {
  const attentionMode = useUIStore((s) => s.attentionMode)
  const toggleAttentionMode = useUIStore((s) => s.toggleAttentionMode)
  const queue = useAttentionQueue()
  const Icon = attentionMode ? RiFocus3Fill : RiFocus3Line
  const badgeCount = attentionMode ? queue.length : 0

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={toggleAttentionMode}
            aria-label={attentionMode ? `Attention mode on (${queue.length} in queue)` : 'Attention mode off'}
            aria-pressed={attentionMode}
            className={cn(
              'relative flex items-center justify-center size-7 rounded-full transition-colors',
              attentionMode
                ? 'bg-amber-500/15 text-amber-400'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50',
            )}
          />
        }
      >
        <Icon className="size-4" />
        {badgeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full text-[9px] font-medium text-white flex items-center justify-center bg-amber-500">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{attentionMode ? 'Attention mode: on' : 'Attention mode: off'}</TooltipContent>
    </Tooltip>
  )
}

function InboxNavButton({ tooltipSide }: { tooltipSide: TooltipSide }) {
  const inboxOpen = useUIStore((s) => s.inboxOpen)
  const setInboxOpen = useUIStore((s) => s.setInboxOpen)
  const counts = useNotificationBadges()
  const Icon = inboxOpen ? RiNotification3Fill : RiNotification3Line
  const badgeCount = counts?.totalBlocking || counts?.totalUrgent || 0
  const badgeColor = counts?.totalBlocking ? 'bg-red-500' : 'bg-orange-400'

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => setInboxOpen(!inboxOpen)}
            aria-label={badgeCount > 0 ? `Notifications (${badgeCount} unread)` : 'Notifications'}
            aria-pressed={inboxOpen}
            className={cn(
              'relative flex items-center justify-center size-7 rounded-full transition-colors',
              inboxOpen
                ? 'bg-white/[0.07] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50',
            )}
          />
        }
      >
        <Icon className="size-4" />
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
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>Notifications</TooltipContent>
    </Tooltip>
  )
}

export function NavTopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeWorkspaceViewId = useUIStore((s) => s.activeWorkspaceViewId)

  return (
    <div className="flex items-center gap-1 px-1.5 pt-2 pb-1 shrink-0">
      {topItems.map((item) => (
        <NavPill
          key={item.to}
          item={item}
          active={item.match(pathname) || (item.to === '/' && !!activeWorkspaceViewId)}
          tooltipSide="bottom"
        />
      ))}
    </div>
  )
}

export function NavBottomBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <div className="flex items-center gap-1 px-1.5 pt-1 pb-2 shrink-0">
      <AttentionModeNavButton tooltipSide="top" />
      <InboxNavButton tooltipSide="top" />
      {bottomItems.map((item) => (
        <NavPill key={item.to} item={item} active={item.match(pathname)} tooltipSide="top" />
      ))}
    </div>
  )
}
