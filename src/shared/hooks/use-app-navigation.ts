import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useViewStore } from '@/features/view'
import { onAppNavigate } from '@/shared/app-bridge'
import { useUIStore } from '@/stores/ui-store'
import type { AgentItemConfig } from '@/types/schema'

/**
 * Listens for `app:navigate` IPC events from the main process
 * (triggered by the tray popup) and navigates the main window's router.
 * Optionally focuses a specific agent pane within the pod.
 */
export function useAppNavigation() {
  const navigate = useNavigate()

  useEffect(() => {
    const unsubscribe = onAppNavigate((route, opts) => {
      navigate({ to: route })

      if (opts?.focusPodId) {
        useUIStore.getState().setActivePodId(opts.focusPodId)
      }

      // Focus the agent's pane once the view store has loaded
      if (opts?.focusPodId && opts?.focusAgentId) {
        const applyFocus = () => {
          const viewStore = useViewStore.getState()
          const podState = viewStore.entities[opts.focusPodId!]
          if (!podState) return false

          const podItem = podState.podItems.find(
            (pi: { contentType: string; config: unknown }) =>
              pi.contentType === 'agent' && (pi.config as AgentItemConfig).podAgentId === opts.focusAgentId,
          )
          if (podItem) {
            useViewStore.setState({ activeEntityId: opts.focusPodId! })
            viewStore.focusPane(podItem.id)
          }
          return true
        }

        if (!applyFocus()) {
          const unsub = useViewStore.subscribe((state) => {
            if (state.entities[opts.focusPodId!]) {
              unsub()
              applyFocus()
            }
          })
        }
      }
    })
    return () => {
      unsubscribe()
    }
  }, [navigate])
}
