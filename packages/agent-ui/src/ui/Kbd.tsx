// -----------------------------------------------------------------------------
// Kbd — inline keyboard hint, monospace, bordered.
// -----------------------------------------------------------------------------

import { cn } from '../cn'

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border-[0.5px] border-border bg-foreground/[0.04] px-1 font-mono text-[10px] leading-none text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
