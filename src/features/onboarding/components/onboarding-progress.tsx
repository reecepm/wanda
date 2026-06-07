import { motion } from 'motion/react'
import { cn } from '@/shared/utils'

interface OnboardingProgressProps {
  /** All step keys, in order. */
  steps: string[]
  /** Currently active step key. */
  currentStep: string
  /** Label for each step (matches steps by index). */
  labels?: Record<string, string>
}

/**
 * Slim progress indicator shown at the top of the onboarding shell. A row of
 * dots that fill as the user advances through the flow.
 */
export function OnboardingProgress({ steps, currentStep, labels }: OnboardingProgressProps) {
  const currentIndex = steps.indexOf(currentStep)

  return (
    <div className="flex items-center gap-3">
      {steps.map((step, i) => {
        const isPast = i < currentIndex
        const isActive = i === currentIndex
        const label = labels?.[step] ?? step
        return (
          <div key={step} className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <motion.div
                className={cn(
                  'size-2 rounded-full',
                  isActive && 'bg-amber-400',
                  isPast && 'bg-amber-500/60',
                  !isActive && !isPast && 'bg-zinc-700',
                )}
                animate={isActive ? { scale: [1, 1.3, 1] } : { scale: 1 }}
                transition={{ duration: 1.8, repeat: isActive ? Infinity : 0 }}
              />
              <span
                className={cn(
                  'text-[10px] transition-colors',
                  isActive ? 'text-zinc-200' : isPast ? 'text-zinc-500' : 'text-zinc-600',
                )}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && <span className="h-px w-4 bg-zinc-800" />}
          </div>
        )
      })}
    </div>
  )
}
