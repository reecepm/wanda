import { create } from 'zustand'

/**
 * In-memory session state for the onboarding flow.
 *
 * Nothing in here is persistent — it's wiped when the flow finishes or is
 * skipped. The actual backend writes (template pod, workspace, workspace
 * settings) happen at the very end, in the complete step, based on this
 * state. Deferring the commit means the user can freely navigate back and
 * forward without spawning duplicate templates or workspaces.
 */
interface OnboardingStore {
  /** Current step key. Initialized to the first step from ONBOARDING_STEPS. */
  currentStep: string
  setCurrentStep: (key: string) => void

  /** Preset key chosen in the template step (e.g. 'carousel'). */
  selectedPresetKey: string | null
  setSelectedPresetKey: (key: string | null) => void

  /** Workspace name entered in the workspace step. */
  workspaceName: string
  setWorkspaceName: (name: string) => void

  /** Workspace working directory entered in the workspace step. */
  workspaceCwd: string
  setWorkspaceCwd: (cwd: string) => void

  /** Step keys the user has completed in this session. */
  completedSteps: Set<string>
  markStepComplete: (key: string) => void

  /** Reset to initial state (used after finish or during dev). */
  reset: () => void
}

// Initial step key. Must match the first entry of ONBOARDING_STEPS in
// config.ts. Hardcoded here (rather than imported) to avoid a circular
// dependency: config.ts → step components → store.ts.
const INITIAL_STEP = 'welcome'

const initial = {
  currentStep: INITIAL_STEP,
  selectedPresetKey: null,
  workspaceName: '',
  workspaceCwd: '',
  completedSteps: new Set<string>(),
}

export const useOnboardingStore = create<OnboardingStore>((set) => ({
  ...initial,
  setCurrentStep: (key) => set({ currentStep: key }),
  setSelectedPresetKey: (key) => set({ selectedPresetKey: key }),
  setWorkspaceName: (name) => set({ workspaceName: name }),
  setWorkspaceCwd: (cwd) => set({ workspaceCwd: cwd }),
  markStepComplete: (key) =>
    set((state) => {
      const next = new Set(state.completedSteps)
      next.add(key)
      return { completedSteps: next }
    }),
  reset: () => set({ ...initial, completedSteps: new Set<string>() }),
}))
