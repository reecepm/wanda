import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { cn } from '@/shared/utils'
import { Button } from '@/ui/button'
import { FEATURE_TOUR_CHAPTERS } from '../chapters'
import type { OnboardingStepProps } from '../config'

/**
 * The feature tour step. Plays through a reel of chapter animations, one at
 * a time, auto-advancing between them on a per-chapter timer.
 *
 * Behavior:
 * - Auto-advance pauses while the mouse is over the stage (so users can
 *   linger on an interesting chapter without it being yanked away).
 * - The LAST chapter does NOT auto-advance off the tour — the user has to
 *   click Continue. This prevents the sudden jump to the "Complete" screen.
 * - Clicking a chapter dot jumps there and resets the timer.
 * - Skip tour exits the entire onboarding (same as the top-level Skip setup).
 *
 * Extensibility: the chapter registry (FEATURE_TOUR_CHAPTERS) drives
 * everything — dots, auto-advance, mount/unmount — so adding a new chapter
 * is a single-file change.
 */
export function FeatureTourStep({ onNext, onBack, onSkip }: OnboardingStepProps) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  const chapter = FEATURE_TOUR_CHAPTERS[index]
  const isLast = index === FEATURE_TOUR_CHAPTERS.length - 1

  // Auto-advance timer. Cleared on unmount, chapter change, pause, or when
  // we reach the final chapter (which waits for an explicit Continue click).
  useEffect(() => {
    if (paused || isLast || !chapter) return
    const t = setTimeout(() => setIndex((i) => i + 1), chapter.minDurationMs)
    return () => clearTimeout(t)
  }, [index, paused, isLast, chapter])

  if (!chapter) return null

  return (
    <div className="flex flex-col items-center gap-5">
      {/* Title + subtitle — crossfades between chapters so the heading
          transition matches the stage transition. */}
      <div className="relative h-[52px] w-full max-w-lg text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={chapter.key}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 flex flex-col items-center gap-1"
          >
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">{chapter.title}</h1>
            <p className="text-xs leading-relaxed text-zinc-500">{chapter.subtitle}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Stage — hover pauses auto-advance. Only the current chapter is
          mounted; the crossfade keys off the chapter key so switching between
          chapters unmounts the old one cleanly.

          The `w-full` on this wrapper AND the motion.div inside is critical:
          the parent is `flex flex-col items-center`, so flex children
          without an explicit width collapse to their content. Without these
          classes the stage shrink-wraps its own `w-full` descendants (a
          circular dependency that bottoms out at the intrinsic content
          width) and ends up tiny. */}
      <div className="w-full" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <AnimatePresence mode="wait">
          <motion.div
            key={chapter.key}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="w-full"
          >
            <chapter.Component />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Chapter dots. The outer button is a generous hit area (h-6 w-10)
          so the dots are easy to click; the visible "pill" inside is smaller
          and scales up on hover for feedback. */}
      <div className="flex items-center gap-1">
        {FEATURE_TOUR_CHAPTERS.map((c, i) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Go to ${c.title}`}
            className="group flex h-6 w-10 items-center justify-center"
          >
            <span
              className={cn(
                'block h-2 rounded-full transition-all group-hover:scale-125',
                i === index ? 'w-8 bg-amber-400' : 'w-2 bg-zinc-700 group-hover:bg-zinc-500',
              )}
            />
          </button>
        ))}
      </div>

      {/* Step nav */}
      <div className="flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            Back
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Skip tour
        </Button>
        <Button size="default" onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  )
}
