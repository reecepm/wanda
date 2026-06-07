import { RiArrowRightSLine, RiComputerLine, RiServerLine } from '@/lib/icons'
import { cn } from '@/shared/utils'

export function StatusBadge({ state }: { state: 'online' | 'offline' | 'loading' }) {
  if (state === 'loading') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 animate-pulse shrink-0" />
        checking…
      </span>
    )
  }
  if (state === 'offline') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
        offline
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
      online
    </span>
  )
}

interface MachineCardProps {
  icon: 'local' | 'remote'
  title: string
  subtitle: string
  state: 'online' | 'offline' | 'loading'
  expanded: boolean
  onToggle: () => void
  actions?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
}

export function MachineCard({
  icon,
  title,
  subtitle,
  state,
  expanded,
  onToggle,
  actions,
  children,
  footer,
}: MachineCardProps) {
  const Icon = icon === 'local' ? RiComputerLine : RiServerLine
  const iconColor =
    icon === 'local'
      ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
      : 'bg-zinc-800 border-zinc-700 text-zinc-400'
  return (
    <article className="flex flex-col gap-3 p-4 rounded-lg border border-zinc-800 bg-zinc-900/40">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-start justify-between gap-3 text-left -m-1 p-1 rounded-md hover:bg-zinc-800/30 transition-colors"
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className={cn('size-9 rounded-md border flex items-center justify-center shrink-0', iconColor)}>
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-100 truncate">{title}</h2>
            <p className="text-[11px] text-zinc-500 font-mono truncate">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {actions}
          <StatusBadge state={state} />
          <RiArrowRightSLine className={cn('size-3.5 text-zinc-500 transition-transform', expanded && 'rotate-90')} />
        </div>
      </button>
      {expanded && children}
      {footer}
    </article>
  )
}
