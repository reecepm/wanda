// -----------------------------------------------------------------------------
// Rail — the 2px left-accent bar that visually binds a whole assistant turn
// (reasoning + tool calls + text) into one unit.
//
// States:
//   idle     — solid muted line (default)
//   running  — animated shimmer along the rail (streaming turn)
//   error    — destructive tint
//   amber    — permission/attention (used for gated turns)
// -----------------------------------------------------------------------------

import type { ReactNode } from 'react'
import { cn } from '../cn'

export type RailState = 'idle' | 'running' | 'error' | 'amber'

export function Rail({
  state = 'idle',
  className,
  children,
}: {
  state?: RailState
  className?: string
  children: ReactNode
}) {
  return (
    <div
      data-rail-state={state}
      className={cn(
        'relative pl-4',
        'before:absolute before:left-0 before:top-1 before:bottom-1 before:w-px',
        state === 'idle' && 'before:bg-border',
        state === 'running' && 'before:bg-foreground/40 before:[animation:agent-rail-pulse_1.6s_ease-in-out_infinite]',
        state === 'error' && 'before:bg-destructive/70',
        state === 'amber' && 'before:bg-amber-400/80',
        className,
      )}
    >
      {children}
    </div>
  )
}
