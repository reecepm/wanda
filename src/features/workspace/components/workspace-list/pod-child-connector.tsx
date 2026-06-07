import { cn } from '@/shared/utils'

/** The L-shaped tree connector drawn to the left of an agent / chat-session row.
 * `tone` switches between the amber attention branch and the zinc default branch;
 * `isLast` stops the vertical line at the elbow for the final child. */
export function PodChildConnector({ tone, isLast }: { tone: 'attention' | 'default'; isLast: boolean }) {
  const lineColor = tone === 'attention' ? 'bg-amber-400/30' : 'bg-zinc-800'
  return (
    <div className="relative w-4 shrink-0">
      <div className={cn('absolute left-[7px] top-0 w-px', lineColor, isLast ? 'h-[14px]' : 'h-full')} />
      <div className={cn('absolute left-[7px] top-[14px] w-[9px] h-px', lineColor)} />
    </div>
  )
}
