// -----------------------------------------------------------------------------
// React hooks that bridge ChatStoreHandle → React via useSyncExternalStore.
// Each hook subscribes to one slice of state so re-renders stay tight.
// -----------------------------------------------------------------------------

import type { AgentCapabilities, MessageId, PlanItem, SessionId, UIMessage } from '@wanda/agent-protocol'
import type { PendingPermission, PendingQuestion, SessionSlice } from '@wanda/agent-store'
import { useMemo, useSyncExternalStore } from 'react'
import { useChatStore } from '../context'

export function useAgentMessages(sessionId: SessionId): ReadonlyArray<UIMessage> {
  const store = useChatStore(sessionId)
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  return useMemo(() => {
    return state.optimisticUserMessage ? [...state.messages, state.optimisticUserMessage] : state.messages
  }, [state.messages, state.optimisticUserMessage])
}

export function useAgentSession(sessionId: SessionId): SessionSlice {
  const store = useChatStore(sessionId)
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().session,
    () => store.getState().session,
  )
}

export function useAgentCapabilities(sessionId: SessionId): AgentCapabilities | null {
  const session = useAgentSession(sessionId)
  return session.capabilities
}

export function usePendingPermissions(sessionId: SessionId): ReadonlyArray<PendingPermission> {
  const store = useChatStore(sessionId)
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().pendingPermissions,
    () => store.getState().pendingPermissions,
  )
}

export function usePendingQuestions(sessionId: SessionId): ReadonlyArray<PendingQuestion> {
  const store = useChatStore(sessionId)
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().pendingQuestions,
    () => store.getState().pendingQuestions,
  )
}

export function useAgentPlan(sessionId: SessionId): ReadonlyArray<PlanItem> | null {
  const store = useChatStore(sessionId)
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().plan,
    () => store.getState().plan,
  )
}

export function useIsWaitingOnUser(sessionId: SessionId): boolean {
  const session = useAgentSession(sessionId)
  return session.isWaitingOnUser
}

/**
 * Subscribe to the most recent `error` event reduced into the store.
 * Returns `null` until an error has fired. Consumers typically render
 * a dismissable banner when this is non-null — without surfacing it
 * somewhere the user sees, a failed turn silently dead-ends (no assistant
 * reply, no visible reason).
 */
export function useAgentLastError(
  sessionId: SessionId,
): { code?: string; message: string; recoverable: boolean } | null {
  const store = useChatStore(sessionId)
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().lastError,
    () => store.getState().lastError,
  )
}

export interface StreamingSnapshot {
  readonly text: string
  readonly lastIndex: number
}

/** Subscribe to a specific streaming part (text or reasoning) on one message. */
export function useStreamingPart(
  sessionId: SessionId,
  messageId: MessageId,
  kind: 'text' | 'reasoning' = 'text',
): StreamingSnapshot | null {
  const store = useChatStore(sessionId)
  const subscribe = useMemo(() => store.streaming.subscribe.bind(store.streaming), [store.streaming])
  const get = useMemo(() => {
    return () => store.streaming.snapshotKey(messageId, kind) ?? null
  }, [store.streaming, messageId, kind])
  const snapshot = useSyncExternalStore(subscribe, get, get)
  if (!snapshot) return null
  return { text: snapshot.text, lastIndex: snapshot.lastIndex }
}
