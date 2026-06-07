import { cn } from '@/shared/utils'
import { MockupFrame, MockupLines } from './mockup-frame'

/**
 * "Tabs" view type: a row of tabs with one focused content area below.
 * When active, both the focused tab AND the content window highlight so
 * the card reads as a single "this is my selection" unit.
 */
export function TabsMockup({ className, active }: { className?: string; active?: boolean }) {
  const tabs = [0, 1, 2]
  return (
    <MockupFrame className={className} active={active}>
      <div className="flex h-full flex-col gap-1">
        {/* Tab row */}
        <div className="flex gap-0.5">
          {tabs.map((i) => (
            <div
              key={i}
              className={cn(
                'h-2 flex-1 rounded-t-sm border-t border-x transition-colors',
                i === 0
                  ? active
                    ? 'bg-amber-500/25 border-amber-500/50'
                    : 'bg-zinc-800 border-zinc-700'
                  : 'bg-zinc-900 border-zinc-800/60',
              )}
            />
          ))}
        </div>
        {/* Content area — highlights together with the focused tab */}
        <div
          className={cn(
            'flex-1 rounded-sm border transition-colors',
            active ? 'border-amber-500/50 bg-amber-500/10' : 'border-zinc-800 bg-zinc-900/70',
          )}
        >
          <MockupLines widths={['75%', '50%', '66%', '40%']} />
        </div>
      </div>
    </MockupFrame>
  )
}
