import { MockupFrame, MockupLines } from './mockup-frame'

/**
 * "Grid" view type: a 4-column grid of widgets with varied sizes, mimicking
 * a dashboard layout. Each widget holds a few skeleton lines so it reads as
 * a mini terminal pane rather than an empty box.
 */
export function GridMockup({ className, active }: { className?: string; active?: boolean }) {
  const widgets: { x: number; y: number; w: number; h: number; widths: string[]; accent?: boolean }[] = [
    { x: 0, y: 0, w: 2, h: 2, widths: ['75%', '55%', '65%', '40%'], accent: true },
    { x: 2, y: 0, w: 2, h: 1, widths: ['60%', '40%'] },
    { x: 2, y: 1, w: 1, h: 1, widths: ['70%'] },
    { x: 3, y: 1, w: 1, h: 1, widths: ['55%'] },
    { x: 0, y: 2, w: 1, h: 1, widths: ['60%'] },
    { x: 1, y: 2, w: 3, h: 1, widths: ['75%', '45%'] },
  ]
  return (
    <MockupFrame className={className} active={active}>
      <div
        className="relative h-full w-full"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: 'repeat(3, 1fr)', gap: 3 }}
      >
        {widgets.map((w, i) => (
          <div
            key={i}
            className={`rounded-sm border ${
              w.accent && active ? 'border-amber-500/50 bg-amber-500/10' : 'border-zinc-800 bg-zinc-900/70'
            }`}
            style={{
              gridColumn: `${w.x + 1} / span ${w.w}`,
              gridRow: `${w.y + 1} / span ${w.h}`,
            }}
          >
            <MockupLines widths={w.widths} />
          </div>
        ))}
      </div>
    </MockupFrame>
  )
}
