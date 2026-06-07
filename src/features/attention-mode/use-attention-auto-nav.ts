import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { useViewStore } from '@/features/view'
import { dismissAttentionWindow, presentAttentionWindow } from '@/shared/app-bridge'
import { useUIStore } from '@/stores/ui-store'
import type { AgentItemConfig } from '@/types/schema'
import { useAttentionQueue } from './use-attention-queue'

interface ReturnLocation {
  podId: string | null
  workspaceViewId: string | null
  pathname: string
}

/**
 * When attention mode is on AND the head of the attention queue changes,
 * navigate the user to that item. A "head change" is either (a) the mode
 * just being enabled, (b) the current head being resolved so a new one
 * surfaces, or (c) a new higher-priority item arriving.
 *
 * Manual navigation is respected: if the user clicks away from the current
 * head, we don't drag them back. Only when the head *itself* changes do we
 * re-navigate.
 *
 * When the queue drains to empty, we return the user to wherever they were
 * before attention mode first pulled them away this session — so handling a
 * notification doesn't leave them stranded on the approval target.
 *
 * The same "pull then restore" pattern extends to the window itself: when a
 * head arrives the main process shows+focuses the window, and if it had been
 * hidden beforehand it gets hidden again once the queue drains.
 */
export function useAttentionAutoNav() {
  const enabled = useUIStore((s) => s.attentionMode)
  const setActivePodId = useUIStore((s) => s.setActivePodId)
  const setActiveWorkspaceViewId = useUIStore((s) => s.setActiveWorkspaceViewId)
  const queue = useAttentionQueue()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const pathnameRef = useRef(pathname)
  const lastNavigatedHeadId = useRef<string | null>(null)
  const returnLocation = useRef<ReturnLocation | null>(null)

  const headId = queue[0]?.id ?? null
  const headRef = useRef(queue[0] ?? null)

  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  useEffect(() => {
    headRef.current = queue[0] ?? null
  }, [queue])

  useEffect(() => {
    if (!enabled) {
      lastNavigatedHeadId.current = null
      returnLocation.current = null
      return
    }
    const head = headRef.current
    if ((head?.id ?? null) !== headId) return
    if (!head) {
      // Queue just emptied. If we previously pulled the user away from their
      // own work, send them back there now.
      const ret = returnLocation.current
      returnLocation.current = null
      lastNavigatedHeadId.current = null
      if (ret) {
        if (ret.workspaceViewId) {
          setActiveWorkspaceViewId(ret.workspaceViewId)
          // Workspace views overlay the router; make sure we're on a page
          // that lets the overlay show through.
          if (pathnameRef.current !== '/' && !pathnameRef.current.startsWith('/pods')) {
            navigate({ to: '/' })
          }
        } else if (ret.podId) {
          setActivePodId(ret.podId)
          navigate({ to: '/pods/$podId', params: { podId: ret.podId } })
        } else {
          setActivePodId(null)
          setActiveWorkspaceViewId(null)
          navigate({ to: ret.pathname })
        }
      }
      dismissAttentionWindow()
      return
    }
    if (head.id === lastNavigatedHeadId.current) return

    presentAttentionWindow()

    // First auto-nav of this session: capture the pre-attention location so
    // we can restore it when the queue empties. Skip if the user is already
    // at the head — there's nothing to return from.
    if (returnLocation.current === null && lastNavigatedHeadId.current === null) {
      const ui = useUIStore.getState()
      const alreadyAtHead = Boolean(head.podId && ui.activePodId === head.podId)
      if (!alreadyAtHead) {
        returnLocation.current = {
          podId: ui.activePodId,
          workspaceViewId: ui.activeWorkspaceViewId,
          pathname: pathnameRef.current,
        }
      }
    }

    lastNavigatedHeadId.current = head.id

    if (!head.podId) return
    setActivePodId(head.podId)
    navigate({ to: '/pods/$podId', params: { podId: head.podId } })

    // If the head is tied to a specific agent terminal, focus the pane hosting
    // that agent. The pod view store may not have loaded yet (first nav into a
    // pod), so we subscribe until the entity materializes and then apply focus.
    if (head.podTerminalId) {
      const targetTerminalId = head.podTerminalId as string
      const targetPodId = head.podId as string

      const applyFocus = () => {
        const viewStore = useViewStore.getState()
        const podState = viewStore.entities[targetPodId]
        if (!podState) return false

        const podItem = podState.podItems.find(
          (pi: { contentType: string; config: unknown }) =>
            pi.contentType === 'agent' && (pi.config as AgentItemConfig).podTerminalId === targetTerminalId,
        )
        if (podItem) {
          useViewStore.setState({ activeEntityId: targetPodId })
          viewStore.focusPane(podItem.id)
        }
        return true
      }

      if (!applyFocus()) {
        const unsub = useViewStore.subscribe((state) => {
          if (state.entities[targetPodId]) {
            unsub()
            applyFocus()
          }
        })
      }
    }
  }, [enabled, headId, navigate, setActivePodId, setActiveWorkspaceViewId])
}
