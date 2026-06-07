// -----------------------------------------------------------------------------
// TurnStamp — uppercase monospaced divider between turns. A small,
// calendar-like structure element that adds breathing room between turns
// without looking like a chat separator.
// -----------------------------------------------------------------------------

import { cn } from '../cn'

export function TurnStamp({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70 select-none',
        className,
      )}
    >
      <span aria-hidden className="h-px flex-1 bg-border/70" />
      <span className="font-mono">{label}</span>
      <span aria-hidden className="h-px flex-1 bg-border/70" />
    </div>
  )
}
