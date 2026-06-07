import { AnimatePresence, motion } from 'motion/react'
import { useMemo } from 'react'
import { Button } from '@/ui/button'
import { PresetPicker } from '../components/preset-picker'
import type { OnboardingStepProps } from '../config'
import { useOnboardingStore } from '../store'

/**
 * Step 2: pick a default template (shows preset cards, one per view type).
 *
 * This step is intentionally a pure client-side selection — it does NOT
 * touch the backend. The chosen preset key is stashed in the onboarding
 * store; the actual template pod is created in the workspace step at the
 * moment the workspace is committed. That way going back to tweak the
 * pick doesn't leave orphaned template pods in the database, and there's
 * no "setting up..." latency on Continue.
 */
export function TemplateStep({ presets, onNext, onBack }: OnboardingStepProps) {
  const selectedPresetKey = useOnboardingStore((s) => s.selectedPresetKey)
  const setSelectedPresetKey = useOnboardingStore((s) => s.setSelectedPresetKey)

  // Defensive re-sort. The backend is already authoritative about order, but
  // sorting here too means any stale/cached response still renders correctly.
  const sortedPresets = useMemo(() => [...presets].sort((a, b) => a.order - b.order), [presets])

  const selectedPreset = sortedPresets.find((p) => p.key === selectedPresetKey) ?? null

  return (
    // Constrain to the original 3xl width — the preset card grid looks
    // better at tighter widths than it does stretched across the full shell.
    // `mx-auto` centers this within the shell's wider (max-w-5xl) container.
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Pick a default layout</h1>
        <p className="max-w-lg text-xs leading-relaxed text-zinc-500">
          This becomes your default template. When you create a new pod, Wanda starts from this layout. You can change
          it later in settings.
        </p>
      </div>

      <PresetPicker
        presets={sortedPresets.map((p) => ({ key: p.key, name: p.name, tagline: p.tagline }))}
        selectedKey={selectedPresetKey}
        onSelect={setSelectedPresetKey}
      />

      {/* Selected description */}
      <div className="min-h-[36px] w-full max-w-lg">
        <AnimatePresence mode="wait">
          {selectedPreset && (
            <motion.p
              key={selectedPreset.key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="text-center text-[11px] leading-relaxed text-zinc-400"
            >
              {selectedPreset.description}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            Back
          </Button>
        )}
        <Button size="default" onClick={onNext} disabled={!selectedPresetKey}>
          Continue
        </Button>
      </div>
    </div>
  )
}
