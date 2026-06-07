import { motion } from 'motion/react'
import { WandaLogo } from '@/features/icons'
import { Button } from '@/ui/button'
import type { OnboardingStepProps } from '../config'

/**
 * Step 1: brief intro. The "front door" of the onboarding flow.
 * Keeps copy minimal so the user can click through fast.
 */
export function WelcomeStep({ onNext }: OnboardingStepProps) {
  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 18, stiffness: 220, delay: 0.1 }}
        className="relative"
      >
        <div className="absolute inset-0 -z-10 rounded-full bg-amber-500/10 blur-2xl" />
        <div className="rounded-full border border-zinc-800 bg-zinc-900/60 p-5">
          <WandaLogo className="size-10 text-zinc-300" />
        </div>
      </motion.div>

      <div className="flex flex-col items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Welcome to Wanda</h1>
        <p className="max-w-md text-xs leading-relaxed text-zinc-500">
          Let's get you set up in a minute. We'll pick a default layout, create your first workspace, and show you one
          of the more powerful things Wanda can do.
        </p>
      </div>

      <Button size="lg" onClick={onNext} className="min-w-36">
        Get started
      </Button>
    </div>
  )
}
