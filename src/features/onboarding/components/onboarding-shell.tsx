import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo } from 'react'
import { WandaLogo } from '@/features/icons'
import { orpcUtils } from '@/shared/orpc'
import { ONBOARDING_STEPS, type OnboardingStepKey } from '../config'
import { useOnboardingStore } from '../store'
import { OnboardingProgress } from './onboarding-progress'

interface OnboardingShellProps {
  onComplete: () => void
  /** Backend-provided preset metadata. Passed through to the template step. */
  presets: Array<{ order: number; key: string; name: string; tagline: string; description: string; viewType: string }>
}

/**
 * Root of the onboarding experience. Owns step navigation and transitions,
 * and finalizes the flow (marks `onboarding.completed = true` and calls
 * onComplete which swaps in the main app).
 *
 * The shell background intentionally matches the splash screen
 * (oklch(0.17 0.004 260)) so the loader → onboarding handoff feels seamless.
 *
 * Extensibility: ONBOARDING_STEPS is an ordered array in ./config.ts. Add a
 * new step by appending an entry there — progress indicator and nav pick it
 * up automatically.
 */
export function OnboardingShell({ onComplete, presets }: OnboardingShellProps) {
  const currentStep = useOnboardingStore((s) => s.currentStep)
  const setCurrentStep = useOnboardingStore((s) => s.setCurrentStep)
  const markStepComplete = useOnboardingStore((s) => s.markStepComplete)
  const resetStore = useOnboardingStore((s) => s.reset)
  const finishOnboardingMutation = useMutation(orpcUtils.onboarding.finish.mutationOptions())

  const stepKeys = useMemo<string[]>(() => ONBOARDING_STEPS.map((s) => s.key), [])
  const stepLabels = useMemo(() => {
    const out: Record<string, string> = {}
    for (const s of ONBOARDING_STEPS) out[s.key] = s.label
    return out
  }, [])

  const activeIndex = stepKeys.indexOf(currentStep)
  const activeStep = ONBOARDING_STEPS[activeIndex] ?? ONBOARDING_STEPS[0]!

  async function finish() {
    try {
      await finishOnboardingMutation.mutateAsync({})
    } finally {
      resetStore()
      onComplete()
    }
  }

  async function skipAll() {
    await finish()
  }

  function goNext() {
    markStepComplete(activeStep.key)
    const next = ONBOARDING_STEPS[activeIndex + 1]
    if (next) {
      setCurrentStep(next.key)
    } else {
      void finish()
    }
  }

  function goBack() {
    const prev = ONBOARDING_STEPS[activeIndex - 1]
    if (prev) setCurrentStep(prev.key)
  }

  function goTo(key: OnboardingStepKey) {
    setCurrentStep(key)
  }

  const StepComponent = activeStep.component

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[oklch(0.17_0.004_260)] text-zinc-200">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 h-[500px] w-[900px] rounded-full bg-amber-500/5 blur-3xl" />

      {/*
        Title bar strip.

        - Height matches the macOS traffic-light inset (hiddenInset window chrome
          sits inside this strip) and gives the step content visible breathing
          room from the top of the window.
        - `drag-region` makes the whole strip draggable so the user can move
          the window from the onboarding chrome just like they can on the main
          app.
        - The logo/label and Skip button are inside the strip but marked
          `no-drag` so they stay clickable; everything else (the empty space
          around them) is draggable.
      */}
      <div className="drag-region relative flex h-11 shrink-0 items-center justify-between px-6">
        <div className="no-drag flex items-center gap-2 pl-16">
          <WandaLogo className="size-5 text-zinc-500" />
          <span className="text-xs font-medium text-zinc-400">Wanda</span>
        </div>
        <div className="no-drag absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <OnboardingProgress steps={stepKeys} currentStep={activeStep.key} labels={stepLabels} />
        </div>
        <button
          type="button"
          onClick={skipAll}
          className="no-drag text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Skip setup
        </button>
      </div>

      {/*
        Step stage. The stage is wide (max-w-5xl) to accommodate the feature
        tour's big animation canvas. Individual steps that want a narrower
        reading width (welcome copy, template picker, workspace form) set
        their own inner max-w — the shell only sets the ceiling.
      */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-11">
        <div className="flex w-full max-w-4xl flex-col items-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStep.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="w-full"
            >
              <StepComponent
                presets={presets}
                onNext={goNext}
                onBack={activeIndex > 0 ? goBack : undefined}
                onSkip={skipAll}
                onFinish={finish}
                onGoTo={goTo}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
