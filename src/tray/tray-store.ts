import { create } from 'zustand'
import type { AgentType } from '@/types/schema'

export type { AgentType } from '@/types/schema'

export type LaunchMode = 'new-pod' | 'existing-pod'

interface TrayStore {
  /** Launch mode: create new pod or spawn agent in existing pod */
  launchMode: LaunchMode
  setLaunchMode: (mode: LaunchMode) => void

  /** Selected pod for existing-pod mode */
  selectedPodId: string | null
  setSelectedPodId: (podId: string | null) => void

  /** Prompt text for quick-input */
  promptText: string
  setPromptText: (text: string) => void

  /** Selected workspace for quick-create mode */
  selectedWorkspaceId: string | null
  setSelectedWorkspaceId: (id: string | null) => void

  /** Selected agent type */
  selectedAgentType: AgentType
  setSelectedAgentType: (type: AgentType) => void
}

export const useTrayStore = create<TrayStore>((set) => ({
  launchMode: 'new-pod',
  setLaunchMode: (launchMode) => set({ launchMode }),

  selectedPodId: null,
  setSelectedPodId: (selectedPodId) => set({ selectedPodId }),

  promptText: '',
  setPromptText: (promptText) => set({ promptText }),

  selectedWorkspaceId: null,
  setSelectedWorkspaceId: (selectedWorkspaceId) => set({ selectedWorkspaceId }),

  selectedAgentType: 'claude',
  setSelectedAgentType: (selectedAgentType) => set({ selectedAgentType }),
}))
