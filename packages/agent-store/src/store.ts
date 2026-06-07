// -----------------------------------------------------------------------------
// `createChatStore(sessionId)` — per-session store facade.
//
// Uses `zustand/vanilla` for the durable state tree; a sibling StreamingAtom
// owns per-token deltas. Both are exposed through one handle so UI hooks
// subscribe to whichever slice they need with a single ref.
// -----------------------------------------------------------------------------

import type { AgentEvent, PromptBlock, SessionId, UIMessage } from '@wanda/agent-protocol'
import { newMessageId } from '@wanda/agent-protocol'
import { createStore } from 'zustand/vanilla'
import { applyEnvelope, type EnvelopeLike } from './dedup.ts'
import { type ChatState, initialChatState } from './state.ts'
import { StreamingAtom } from './streaming-atom.ts'

export interface ChatStoreHandle {
  getState(): ChatState
  subscribe(listener: (state: ChatState, prev: ChatState) => void): () => void
  applyEnvelopes(envs: ReadonlyArray<EnvelopeLike>): void
  /** Hot path: one live event, already has a seq from the envelope. */
  applyLiveEvent(event: AgentEvent, seq: number): void
  /**
   * Out-of-band metadata refresh from `agent.session.get`.
   *
   * This intentionally does not consume or mutate `appliedSeq`: session detail
   * is not an event-log envelope, and using a fake seq can get ignored after
   * replay has already advanced the cursor.
   */
  hydrateSessionMetadata(event: Extract<AgentEvent, { kind: 'session.started' }>): void
  /**
   * Scroll-up backfill prepend. Events must already be ordered by seq ASC.
   * Uses the same dedup applier so re-appending rows is idempotent.
   */
  prependBackfill(envs: ReadonlyArray<EnvelopeLike>): void
  setPhase(phase: ChatState['phase']): void
  setEpoch(epoch: number): void
  markAtHead(): void
  startOptimisticUserMessage(blocks: ReadonlyArray<PromptBlock>): UIMessage['id'] | null
  bindOptimisticUserTurn(turnId: string): void
  clearOptimisticUserMessage(): void
  reset(): void
  readonly streaming: StreamingAtom
}

export function createChatStore(sessionId: SessionId): ChatStoreHandle {
  const z = createStore<ChatState>(() => initialChatState(sessionId))
  const streaming = new StreamingAtom()

  function ensureStreamingMessage(state: ChatState, messageId: UIMessage['id']): ChatState {
    const currentActive = state.session.activeAssistantMessageId
    const existingIndex = state.messageIndex.get(messageId)
    if (existingIndex !== undefined) {
      if (currentActive === messageId) return state
      return {
        ...state,
        session: { ...state.session, activeAssistantMessageId: messageId },
      }
    }

    const message: UIMessage = {
      id: messageId,
      role: 'assistant',
      parts: [],
      createdAt: Date.now(),
    }
    const nextMessages = [...state.messages, message]
    const nextIndex = new Map(state.messageIndex)
    nextIndex.set(messageId, nextMessages.length - 1)
    return {
      ...state,
      messages: nextMessages,
      messageIndex: nextIndex,
      session: { ...state.session, activeAssistantMessageId: messageId },
    }
  }

  function routeEnvelope(state: ChatState, env: EnvelopeLike): ChatState {
    const p = env.payload
    if (p.kind === 'text.delta' || p.kind === 'reasoning.delta') {
      // Deltas don't persist (04 §4); route through the streaming atom and
      // do not consume a seq (they arrive only via live tail).
      streaming.appendDelta({
        sessionId,
        messageId: p.messageId,
        kind: p.kind === 'text.delta' ? 'text' : 'reasoning',
        text: p.text,
        index: p.index,
        ts: Date.now(),
      })
      return ensureStreamingMessage(state, p.messageId)
    }
    if (
      p.kind === 'text.completed' &&
      p.role === 'user' &&
      state.optimisticUserMessage &&
      (state.optimisticUserTurnId == null || state.optimisticUserTurnId === p.turnId)
    ) {
      state = {
        ...state,
        optimisticUserMessage: null,
        optimisticUserTurnId: null,
      }
    }
    if (p.kind === 'text.completed') {
      streaming.complete(p.messageId, 'text')
    } else if (p.kind === 'reasoning.completed') {
      streaming.complete(p.messageId, 'reasoning')
    }
    return applyEnvelope(state, env)
  }

  function applyEnvelopes(envs: ReadonlyArray<EnvelopeLike>): void {
    if (envs.length === 0) return
    z.setState((prev) => {
      let next = prev
      for (const env of envs) next = routeEnvelope(next, env)
      return next
    }, true)
  }

  function applyLiveEvent(event: AgentEvent, seq: number): void {
    applyEnvelopes([{ seq, payload: event }])
  }

  function hydrateSessionMetadata(event: Extract<AgentEvent, { kind: 'session.started' }>): void {
    z.setState((prev) => {
      const next = {
        ...prev,
        session: {
          ...prev.session,
          providerId: event.providerId,
          capabilities: event.capabilities,
          modes: event.modes,
          modelOptions: event.modelOptions,
          currentModeId: event.currentModeId ?? prev.session.currentModeId,
          modelId: event.modelId ?? prev.session.modelId,
          reasoningEffort: event.reasoningEffort ?? prev.session.reasoningEffort,
          status: prev.session.status === 'starting' ? 'ready' : prev.session.status,
          closedReason: null,
        },
      }
      return next
    })
  }

  function prependBackfill(envs: ReadonlyArray<EnvelopeLike>): void {
    if (envs.length === 0) return
    z.setState((prev) => {
      let next = prev
      for (const env of envs) next = routeEnvelope(next, env)
      const first = envs[0]
      if (first !== undefined) {
        const oldest = prev.oldestSeq === null ? first.seq : Math.min(prev.oldestSeq, first.seq)
        if (oldest !== prev.oldestSeq) {
          next = { ...next, oldestSeq: oldest }
        }
      }
      return next
    }, true)
  }

  function setPhase(phase: ChatState['phase']): void {
    z.setState((s) => (s.phase === phase ? s : { ...s, phase }))
  }

  function setEpoch(epoch: number): void {
    z.setState((s) => (s.epoch === epoch ? s : { ...s, epoch }))
  }

  function markAtHead(): void {
    z.setState((s) => (s.atHead ? s : { ...s, atHead: true }))
  }

  function startOptimisticUserMessage(blocks: ReadonlyArray<PromptBlock>): UIMessage['id'] | null {
    const textBlocks = blocks.filter((block): block is Extract<PromptBlock, { kind: 'text' }> => block.kind === 'text')
    const text = textBlocks.map((block) => block.text).join('\n')
    const attachments = blocks.filter(
      (block): block is Extract<PromptBlock, { kind: 'attachment' | 'image' }> =>
        block.kind === 'attachment' || block.kind === 'image',
    )
    if (text.length === 0 && attachments.length === 0) return null
    const messageId = newMessageId()
    const message: UIMessage = {
      id: messageId,
      role: 'user',
      createdAt: Date.now(),
      parts: [
        {
          type: 'text',
          text,
          state: 'done',
          ...(attachments.length > 0 ? { attachments } : {}),
          index: 0,
        },
      ],
    }
    z.setState((state) => ({
      ...state,
      optimisticUserMessage: message,
      optimisticUserTurnId: null,
    }))
    return messageId
  }

  function bindOptimisticUserTurn(turnId: string): void {
    z.setState((state) => {
      if (!state.optimisticUserMessage) return state
      if (state.optimisticUserTurnId === turnId) return state
      return { ...state, optimisticUserTurnId: turnId }
    })
  }

  function clearOptimisticUserMessage(): void {
    z.setState((state) => {
      if (!state.optimisticUserMessage && !state.optimisticUserTurnId) return state
      return {
        ...state,
        optimisticUserMessage: null,
        optimisticUserTurnId: null,
      }
    })
  }

  function reset(): void {
    streaming.clear()
    z.setState(initialChatState(sessionId), true)
  }

  return {
    getState: z.getState,
    subscribe: z.subscribe,
    applyEnvelopes,
    applyLiveEvent,
    hydrateSessionMetadata,
    prependBackfill,
    setPhase,
    setEpoch,
    markAtHead,
    startOptimisticUserMessage,
    bindOptimisticUserTurn,
    clearOptimisticUserMessage,
    reset,
    streaming,
  }
}
