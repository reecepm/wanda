import { cn } from '@/shared/utils'
import { MockupFrame, MockupLines } from './mockup-frame'

/**
 * "Split Pane" view type: a left pane and a right pane divided vertically,
 * with the right pane split horizontally into top and bottom. When active,
 * the top-right pane highlights — picking a single focused window makes the
 * "this is where your eye lands" intent clear.
 */
export function SplitPaneMockup({ className, active }: { className?: string; active?: boolean }) {
  const dividerColor = active ? 'bg-amber-500/40' : 'bg-zinc-700/60'
  const focusedPane = cn(
    'rounded-sm border transition-colors',
    active ? 'border-amber-500/50 bg-amber-500/10' : 'border-zinc-800 bg-zinc-900/70',
  )
  const idlePane = 'rounded-sm border border-zinc-800 bg-zinc-900/70'
  return (
    <MockupFrame className={className} active={active}>
      <div className="flex h-full gap-0.5">
        {/* Left pane */}
        <div className={cn('w-[45%]', idlePane)}>
          <MockupLines widths={['75%', '50%', '66%']} />
        </div>
        {/* Vertical divider */}
        <div className={`w-0.5 rounded-full ${dividerColor}`} />
        {/* Right column (split horizontally) */}
        <div className="flex flex-1 flex-col gap-0.5">
          {/* Top-right is the focused pane when the card is active */}
          <div className={cn('flex-1', focusedPane)}>
            <MockupLines widths={['66%', '45%']} />
          </div>
          <div className={`h-0.5 rounded-full ${dividerColor}`} />
          <div className={cn('flex-1', idlePane)}>
            <MockupLines widths={['50%', '70%']} />
          </div>
        </div>
      </div>
    </MockupFrame>
  )
}
