import { cn } from '@/shared/utils'

/**
 * Shared chrome for all view-type mockups. Gives each card the same "window"
 * frame so the card grid feels consistent, and centralizes the aspect ratio.
 */
export function MockupFrame({
  children,
  className,
  active,
}: {
  children: React.ReactNode
  className?: string
  active?: boolean
}) {
  return (
    <div
      className={cn(
        'relative aspect-[16/10] w-full overflow-hidden rounded-md border bg-zinc-950/60 transition-colors',
        active ? 'border-amber-500/60 shadow-[0_0_0_1px_rgba(245,158,11,0.25)]' : 'border-zinc-800',
        className,
      )}
    >
      {/* Title-bar dots */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800/80 bg-zinc-900/60">
        <span className="size-1 rounded-full bg-zinc-700" />
        <span className="size-1 rounded-full bg-zinc-700" />
        <span className="size-1 rounded-full bg-zinc-700" />
      </div>
      <div className="relative p-1.5 h-[calc(100%-17px)]">{children}</div>
    </div>
  )
}

/**
 * Skeleton content for a mockup "cell" (a pane, widget, tab, node, etc.).
 * Used across every mockup so each variant has the same visual weight — a
 * handful of fake text lines that evoke terminal output.
 *
 * `widths` lets callers tweak the row lengths for variety between cells.
 */
export function MockupLines({ widths = ['75%', '50%', '66%'], className }: { widths?: string[]; className?: string }) {
  return (
    <div className={cn('flex h-full w-full flex-col gap-0.5 p-1', className)}>
      {widths.map((w, i) => (
        <div key={i} className="h-0.5 rounded-full bg-zinc-700/50" style={{ width: w, opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  )
}
