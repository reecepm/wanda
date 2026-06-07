import { motion } from 'motion/react'
import { cn } from '@/shared/utils'
import { MockupFrame, MockupLines } from './mockup-frame'

/**
 * "Carousel" view type: a row of horizontally scrolling cards with the
 * focused one in the center. The slide animation runs continuously and is
 * intentionally decoupled from the `active` state — we don't want clicking
 * the card to restart the animation from its first keyframe. `active` only
 * controls the highlight on the center card.
 */
export function CarouselMockup({ className, active }: { className?: string; active?: boolean }) {
  const items = [
    { widths: ['60%', '40%'] },
    { widths: ['70%', '50%'] },
    { widths: ['75%', '55%', '40%'] },
    { widths: ['65%', '45%'] },
    { widths: ['55%', '70%'] },
  ]
  return (
    <MockupFrame className={className} active={active}>
      <div className="relative h-full overflow-hidden">
        <motion.div
          className="flex h-full items-center gap-1"
          animate={{ x: [-8, 0, -8] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          {items.map((item, i) => (
            <div
              key={i}
              className={cn(
                'h-[85%] shrink-0 rounded-sm border transition-colors',
                i === 2 && active ? 'border-amber-500/50 bg-amber-500/10' : 'border-zinc-800 bg-zinc-900/70',
              )}
              style={{ width: '28%' }}
            >
              <MockupLines widths={item.widths} />
            </div>
          ))}
        </motion.div>
        {/* Gradient fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-zinc-950/80 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-4 bg-gradient-to-l from-zinc-950/80 to-transparent" />
      </div>
    </MockupFrame>
  )
}
