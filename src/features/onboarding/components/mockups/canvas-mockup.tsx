import { MockupFrame, MockupLines } from './mockup-frame'

/**
 * "Canvas" view type: free-form windows positioned on an infinite 2D plane,
 * with a subtle dot-grid background to convey pan/zoom. Each node reads as
 * a mini window (chrome dots + content lines) so the card matches the other
 * layouts visually.
 */
export function CanvasMockup({ className, active }: { className?: string; active?: boolean }) {
  const nodes: { x: number; y: number; w: number; h: number; widths: string[]; accent?: boolean }[] = [
    { x: 10, y: 14, w: 34, h: 34, widths: ['70%', '50%', '60%'], accent: true },
    { x: 54, y: 8, w: 36, h: 28, widths: ['65%', '45%'] },
    { x: 48, y: 52, w: 28, h: 32, widths: ['55%', '70%'] },
    { x: 8, y: 58, w: 32, h: 28, widths: ['60%', '40%'] },
  ]
  return (
    <MockupFrame className={className} active={active}>
      <div
        className="relative h-full w-full rounded-sm"
        style={{
          backgroundImage: 'radial-gradient(rgba(113,113,122,0.25) 1px, transparent 1px)',
          backgroundSize: '8px 8px',
        }}
      >
        {nodes.map((n, i) => (
          <div
            key={i}
            className={`absolute flex flex-col overflow-hidden rounded-sm border ${
              n.accent && active ? 'border-amber-500/60 bg-amber-500/10' : 'border-zinc-700/80 bg-zinc-900/80'
            }`}
            style={{
              left: `${n.x}%`,
              top: `${n.y}%`,
              width: `${n.w}%`,
              height: `${n.h}%`,
            }}
          >
            {/* Mini window chrome */}
            <div className="flex items-center gap-[2px] border-b border-zinc-800/80 bg-zinc-900/60 px-1 py-[2px]">
              <span className="size-[2px] rounded-full bg-zinc-700" />
              <span className="size-[2px] rounded-full bg-zinc-700" />
              <span className="size-[2px] rounded-full bg-zinc-700" />
            </div>
            <div className="flex-1">
              <MockupLines widths={n.widths} />
            </div>
          </div>
        ))}
      </div>
    </MockupFrame>
  )
}
