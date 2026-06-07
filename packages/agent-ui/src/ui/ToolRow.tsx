// -----------------------------------------------------------------------------
// ToolRow — the canonical shape for an agent tool invocation.
//
//   ├─ icon · title · subtitle · status · chevron
//   └─ (expanded body)
//
// A tool row is a single line by default (~h-7). Clicking the header
// expands to reveal its body (if there is one). Status drives the icon
// color (pending, running, completed, failed, cancelled).
// -----------------------------------------------------------------------------

import { type ReactNode, useCallback, useState } from 'react'
import { cn } from '../cn'
import { IconAlert, IconCheck, IconChevronDown, IconChevronRight } from './icons'
import { ShimmerDot } from './Shimmer'

export type ToolRowStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

function StatusGlyph({ status }: { status: ToolRowStatus }) {
  if (status === 'in_progress' || status === 'pending') {
    return <ShimmerDot className="ml-1" />
  }
  if (status === 'completed') {
    return <IconCheck className="text-emerald-500 dark:text-emerald-400" />
  }
  if (status === 'failed') {
    return <IconAlert className="text-destructive" />
  }
  if (status === 'cancelled') {
    return <span className="font-mono text-[10px] text-muted-foreground/70">—</span>
  }
  return null
}

export function ToolRow({
  icon,
  title,
  subtitle,
  status,
  body,
  defaultOpen,
  className,
  onToggle,
}: {
  icon?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  status: ToolRowStatus
  body?: ReactNode
  defaultOpen?: boolean
  className?: string
  onToggle?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(defaultOpen ?? (status === 'in_progress' || status === 'failed'))
  const toggleable = body != null
  const toggle = useCallback(() => {
    if (!toggleable) return
    setOpen((prev) => {
      const next = !prev
      onToggle?.(next)
      return next
    })
  }, [onToggle, toggleable])

  return (
    <div
      className={cn(
        'group/toolrow border-l border-border pl-3 transition-colors',
        status === 'failed' && 'border-destructive/50',
        status === 'in_progress' && 'border-foreground/40',
        className,
      )}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={!toggleable}
        className={cn(
          'flex h-7 w-full items-center gap-2 text-left',
          'text-[12px] text-muted-foreground',
          'outline-none focus-visible:text-foreground',
          toggleable && 'hover:text-foreground',
        )}
        aria-expanded={toggleable ? open : undefined}
      >
        {icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center text-foreground/70">{icon}</span>}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-medium text-foreground">{title}</span>
          {subtitle && <span className="truncate font-mono text-[11px] text-muted-foreground/80">{subtitle}</span>}
        </span>
        <span className="shrink-0">
          <StatusGlyph status={status} />
        </span>
        {toggleable && (
          <span className="shrink-0 text-muted-foreground/60 transition-transform">
            {open ? <IconChevronDown /> : <IconChevronRight />}
          </span>
        )}
      </button>
      {toggleable && open && <div className="py-1.5 pr-1 text-[12px] text-foreground">{body}</div>}
    </div>
  )
}
