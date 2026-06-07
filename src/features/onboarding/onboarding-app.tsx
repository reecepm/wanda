import type { AppClient } from '../../../shared/contracts'
import { OnboardingShell } from './components/onboarding-shell'

type OnboardingStatus = Awaited<ReturnType<AppClient['onboarding']['getStatus']>>

/**
 * Standalone root mounted in place of the main router while onboarding is
 * active. The preset metadata is passed in from main.tsx (which already
 * fetched it during startup), so this component does zero additional data
 * loading on mount — the first paint is the onboarding shell with real data.
 *
 * Kept deliberately thin: it's just a prop passthrough. All step logic lives
 * in ./components/onboarding-shell.tsx and ./steps/*.
 */
export function OnboardingApp({
  initialStatus,
  onComplete,
}: {
  initialStatus: OnboardingStatus
  onComplete: () => void
}) {
  if (!initialStatus.presets.length) {
    // The initial fetch failed (or returned nothing). Show a visible
    // fallback rather than a silent blank screen so the user can at least
    // reload and we can see that something's wrong.
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-[oklch(0.17_0.004_260)] p-8 text-zinc-300">
        <div className="text-sm font-medium">Wanda couldn't load the onboarding presets.</div>
        <div className="text-[11px] text-zinc-500">
          This usually means the backend isn't responding yet. Try reloading.
        </div>
        <button
          type="button"
          onClick={() => location.reload()}
          className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
        >
          Reload
        </button>
      </div>
    )
  }
  return <OnboardingShell onComplete={onComplete} presets={initialStatus.presets} />
}
