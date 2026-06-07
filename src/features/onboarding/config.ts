import type { ComponentType } from 'react'
import { CompleteStep } from './steps/complete-step'
import { FeatureTourStep } from './steps/feature-tour-step'
import { TemplateStep } from './steps/template-step'
import { WelcomeStep } from './steps/welcome-step'
import { WorkspaceStep } from './steps/workspace-step'

/**
 * Keys for the built-in onboarding steps. Add new keys as you add steps.
 * The string values end up as settings-table identifiers, so don't rename
 * without a migration plan.
 */
export type OnboardingStepKey = 'welcome' | 'template' | 'workspace' | 'tour' | 'complete'

export interface OnboardingStepProps {
  presets: Array<{ order: number; key: string; name: string; tagline: string; description: string; viewType: string }>
  /** Advance to the next step (or finish if this is the last one). */
  onNext: () => void
  /** Go back to the previous step. Undefined on the first step. */
  onBack?: () => void
  /** Skip the entire flow and mark onboarding complete. */
  onSkip: () => void
  /** Explicitly finish the flow. Called by the final step's CTA. */
  onFinish: () => void
  /** Jump directly to a specific step key. Useful for "Edit your pick" links. */
  onGoTo: (key: OnboardingStepKey) => void
}

export interface OnboardingStepDef {
  key: OnboardingStepKey
  label: string
  component: ComponentType<OnboardingStepProps>
}

/**
 * The ordered list of onboarding steps. Append new entries here to extend the
 * flow — the shell's progress indicator, navigation, and completion tracking
 * all read from this array.
 *
 * Structure:
 *   welcome   → intro
 *   template  → REQUIRED: pick default layout
 *   workspace → REQUIRED: create first workspace
 *   tour      → PASSIVE: auto-advancing feature reel (see chapters/index.ts)
 *   complete  → done
 *
 * To add a whole new onboarding step: create the component in ./steps/,
 * import it here, add a new key to OnboardingStepKey, and append an entry.
 *
 * To add a new FEATURE TEASER inside the tour (recommended default for new
 * animations): don't touch this file — add a chapter to
 * src/features/onboarding/chapters/index.ts instead.
 */
export const ONBOARDING_STEPS: OnboardingStepDef[] = [
  { key: 'welcome', label: 'Welcome', component: WelcomeStep },
  { key: 'template', label: 'Template', component: TemplateStep },
  { key: 'workspace', label: 'Workspace', component: WorkspaceStep },
  { key: 'tour', label: 'Tour', component: FeatureTourStep },
  { key: 'complete', label: 'Done', component: CompleteStep },
]
