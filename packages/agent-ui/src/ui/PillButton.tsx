// -----------------------------------------------------------------------------
// PillButton — thin, low-profile pill used throughout the composer toolbar
// and header. Ultra-thin border (0.5px), subtle surface, focus ring.
// -----------------------------------------------------------------------------

import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react'
import { cn } from '../cn'

export interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly leading?: ReactNode
  readonly trailing?: ReactNode
  readonly variant?: 'ghost' | 'solid' | 'outline' | 'danger'
  readonly size?: 'sm' | 'md'
  readonly active?: boolean
}

export const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(function PillButton(
  { leading, trailing, children, variant = 'ghost', size = 'sm', active, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      data-active={active ? '' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        'transition-colors transition-[box-shadow] duration-150',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' && 'h-7 px-2.5 text-[11px]',
        size === 'md' && 'h-8 px-3 text-xs',
        variant === 'ghost' &&
          'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground data-[active]:bg-foreground/[0.08] data-[active]:text-foreground',
        variant === 'outline' &&
          'border-[0.5px] border-border bg-foreground/[0.03] text-foreground hover:bg-foreground/[0.06]',
        variant === 'solid' && 'bg-foreground text-background hover:bg-foreground/90',
        variant === 'danger' && 'border-[0.5px] border-destructive/40 text-destructive hover:bg-destructive/10',
        className,
      )}
      {...rest}
    >
      {leading && <span className="shrink-0">{leading}</span>}
      {children != null && <span className="truncate">{children}</span>}
      {trailing && <span className="shrink-0 opacity-70">{trailing}</span>}
    </button>
  )
})
