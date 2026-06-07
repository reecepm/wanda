// -----------------------------------------------------------------------------
// Pure reducer: ChatState × AgentEvent → ChatState.
//
// Returns the same reference when a no-op (prevents memo cascade). Does NOT
// handle text.delta / reasoning.delta — those go through the StreamingAtom.
// The reducer is replay-safe: reducing the same event twice yields the same
// state. `applyEnvelope` in dedup.ts enforces seq-based dedup at the caller.
// -----------------------------------------------------------------------------

import type { AgentEvent, MessageId, Part, ToolKind, ToolPart, UIMessage } from '@wanda/agent-protocol'
import type { ChatState, PendingPermission, PendingQuestion } from './state.ts'

// Local narrowing helper named to avoid shadowing TS's builtin `Extract`.
// Extracts a specific `AgentEvent` variant by `kind`.
type EventOfKind<E, K> = E extends { kind: K } ? E : never

// --- Top-level dispatch -------------------------------------------------------

export function reduce(state: ChatState, event: AgentEvent): ChatState {
  switch (event.kind) {
    case 'session.started':
      return reduceSessionStarted(state, event)
    case 'session.closed':
      return reduceSessionClosed(state, event)
    case 'turn.started':
      return reduceTurnStarted(state, event)
    case 'turn.completed':
      return reduceTurnCompleted(state, event)
    case 'turn.cancelled':
      return reduceTurnCancelled(state, event)
    case 'text.delta':
    case 'reasoning.delta':
      return state // live-only; StreamingAtom handles these
    case 'text.completed':
      return reduceTextCompleted(state, event)
    case 'reasoning.completed':
      return reduceReasoningCompleted(state, event)
    case 'tool.started':
      return reduceToolStarted(state, event)
    case 'tool.updated':
      return reduceToolUpdated(state, event)
    case 'tool.completed':
      return reduceToolCompleted(state, event)
    case 'plan.updated':
      return reducePlanUpdated(state, event)
    case 'permission.requested':
      return reducePermissionRequested(state, event)
    case 'permission.resolved':
      return reducePermissionResolved(state, event)
    case 'question.requested':
      return reduceQuestionRequested(state, event)
    case 'question.resolved':
      return reduceQuestionResolved(state, event)
    case 'mode.changed':
      return reduceModeChanged(state, event)
    case 'model.changed':
      return reduceModelChanged(state, event)
    case 'reasoning.effort.changed':
      return reduceReasoningEffortChanged(state, event)
    case 'error':
      return reduceError(state, event)
    default:
      // Forward-compat: unknown kind is a no-op, not a throw (01 §6).
      return state
  }
}

// --- Session / turn -----------------------------------------------------------

function reduceSessionStarted(state: ChatState, e: EventOfKind<AgentEvent, 'session.started'>): ChatState {
  return {
    ...state,
    session: {
      ...state.session,
      providerId: e.providerId,
      capabilities: e.capabilities,
      modes: e.modes,
      modelOptions: e.modelOptions,
      currentModeId: e.currentModeId ?? null,
      modelId: e.modelId ?? null,
      reasoningEffort: e.reasoningEffort ?? null,
      status: 'ready',
      closedReason: null,
    },
  }
}

function reduceSessionClosed(state: ChatState, e: EventOfKind<AgentEvent, 'session.closed'>): ChatState {
  return {
    ...state,
    session: {
      ...state.session,
      status: 'closed',
      closedReason: e.reason,
      activeAssistantMessageId: null,
      activeTurnId: null,
      isWaitingOnUser: false,
    },
  }
}

function reduceTurnStarted(state: ChatState, e: EventOfKind<AgentEvent, 'turn.started'>): ChatState {
  const existing = state.turns[e.turnId]
  if (existing && existing.status === 'running') return state
  return {
    ...state,
    turns: { ...state.turns, [e.turnId]: { turnId: e.turnId, status: 'running', startedAt: Date.now() } },
    session: {
      ...state.session,
      status: 'running',
      activeTurnId: e.turnId,
      activeAssistantMessageId: null,
    },
  }
}

function reduceTurnCompleted(state: ChatState, e: EventOfKind<AgentEvent, 'turn.completed'>): ChatState {
  const existing = state.turns[e.turnId]
  const next = {
    turnId: e.turnId,
    status: 'completed' as const,
    stopReason: e.stopReason,
    startedAt: existing?.startedAt ?? Date.now(),
    completedAt: Date.now(),
    usage: e.usage,
  }
  return {
    ...state,
    turns: { ...state.turns, [e.turnId]: next },
    session: {
      ...state.session,
      status: 'ready',
      activeTurnId: state.session.activeTurnId === e.turnId ? null : state.session.activeTurnId,
      activeAssistantMessageId: null,
    },
  }
}

function reduceTurnCancelled(state: ChatState, e: EventOfKind<AgentEvent, 'turn.cancelled'>): ChatState {
  const existing = state.turns[e.turnId]
  const next = {
    turnId: e.turnId,
    status: 'cancelled' as const,
    startedAt: existing?.startedAt ?? Date.now(),
    completedAt: Date.now(),
  }
  return {
    ...state,
    turns: { ...state.turns, [e.turnId]: next },
    session: {
      ...state.session,
      status: 'ready',
      activeTurnId: state.session.activeTurnId === e.turnId ? null : state.session.activeTurnId,
      activeAssistantMessageId: null,
    },
  }
}

// --- Text / reasoning ---------------------------------------------------------

function reduceTextCompleted(state: ChatState, e: EventOfKind<AgentEvent, 'text.completed'>): ChatState {
  const role = e.role ?? 'assistant'
  const { state: s1, message, index } = upsertMessage(state, e.messageId, role)
  const attachments = e.attachments && e.attachments.length > 0 ? [...e.attachments] : undefined
  const updated = replaceOrAppendPart(
    message,
    (p) => p.type === 'text',
    (idx) => ({
      type: 'text',
      text: e.text,
      state: 'done',
      ...(attachments ? { attachments } : {}),
      index: idx,
    }),
  )
  const s2 = writeMessage(s1, index, updated)
  // Only track the active assistant message on the session; user messages
  // get written but don't become the "currently streaming into" target.
  if (role !== 'assistant') return s2
  return {
    ...s2,
    session: { ...s2.session, activeAssistantMessageId: e.messageId },
  }
}

function reduceReasoningCompleted(state: ChatState, e: EventOfKind<AgentEvent, 'reasoning.completed'>): ChatState {
  const { state: s1, message, index } = upsertMessage(state, e.messageId, 'assistant')
  const updated = replaceOrAppendPart(
    message,
    (p) => p.type === 'reasoning',
    (idx) => ({ type: 'reasoning', text: e.text, state: 'done', index: idx }),
  )
  const s2 = writeMessage(s1, index, updated)
  return {
    ...s2,
    session: { ...s2.session, activeAssistantMessageId: e.messageId },
  }
}

// --- Tools --------------------------------------------------------------------

function reduceToolStarted(state: ChatState, e: EventOfKind<AgentEvent, 'tool.started'>): ChatState {
  const existing = findToolPart(state, e.toolCallId)
  if (existing) return state // idempotent on replay
  const { state: s1, message, index, messageId } = getOrCreateActiveMessage(state, e.turnId)
  const newPart = makeToolPart({
    toolCallId: e.toolCallId,
    toolKind: e.toolKind,
    status: 'in_progress',
    title: e.title,
    detail: e.detail,
    locations: e.locations,
    index: message.parts.length,
  })
  const updated: UIMessage = { ...message, parts: [...message.parts, newPart] }
  const s2 = writeMessage(s1, index, updated)
  return {
    ...s2,
    session: { ...s2.session, activeAssistantMessageId: messageId },
  }
}

function reduceToolUpdated(state: ChatState, e: EventOfKind<AgentEvent, 'tool.updated'>): ChatState {
  const found = findToolPart(state, e.toolCallId)
  if (!found) return state
  const { message, messageIndex, part } = found
  const newStatus = mergeToolStatus(part.status, e.status)
  if (newStatus === part.status && e.detail === undefined) return state
  const nextPart = {
    ...part,
    status: newStatus,
    detail: e.detail ?? part.detail,
  } as Part
  const parts = message.parts.map((p) =>
    p.type === part.type && 'toolCallId' in p && p.toolCallId === e.toolCallId ? nextPart : p,
  )
  return writeMessage(state, messageIndex, { ...message, parts })
}

function reduceToolCompleted(state: ChatState, e: EventOfKind<AgentEvent, 'tool.completed'>): ChatState {
  const found = findToolPart(state, e.toolCallId)
  if (!found) return state
  const { message, messageIndex, part } = found
  const newStatus = mergeToolStatus(part.status, e.status)
  const nextPart = {
    ...part,
    status: newStatus,
    result: e.result,
  } as Part
  const parts = message.parts.map((p) =>
    p.type === part.type && 'toolCallId' in p && p.toolCallId === e.toolCallId ? nextPart : p,
  )
  return writeMessage(state, messageIndex, { ...message, parts })
}

// --- Plan --------------------------------------------------------------------

function reducePlanUpdated(state: ChatState, e: EventOfKind<AgentEvent, 'plan.updated'>): ChatState {
  if (e.plan.length === 0 && state.plan === null) return state
  const plan = [...e.plan]
  return {
    ...state,
    plan,
    hasActivePlan: plan.some((p) => p.status === 'pending' || p.status === 'in_progress'),
  }
}

// --- Permission --------------------------------------------------------------

function reducePermissionRequested(state: ChatState, e: EventOfKind<AgentEvent, 'permission.requested'>): ChatState {
  // Idempotent by requestId
  if (state.pendingPermissions.some((p) => p.requestId === e.requestId)) return state
  const entry: PendingPermission = {
    requestId: e.requestId,
    request: e,
    arrivedAt: Date.now(),
    timeoutAt: e.timeoutAt ?? null,
  }
  const { state: s1, message, index, messageId } = getOrCreateActiveMessage(state, e.turnId)
  const newPart: Part = {
    type: 'permission',
    requestId: e.requestId,
    request: e.request,
    index: message.parts.length,
  }
  const updated: UIMessage = { ...message, parts: [...message.parts, newPart] }
  const s2 = writeMessage(s1, index, updated)
  return {
    ...s2,
    pendingPermissions: [...state.pendingPermissions, entry],
    session: {
      ...s2.session,
      activeAssistantMessageId: messageId,
      isWaitingOnUser: true,
    },
  }
}

function reducePermissionResolved(state: ChatState, e: EventOfKind<AgentEvent, 'permission.resolved'>): ChatState {
  const idx = state.pendingPermissions.findIndex((p) => p.requestId === e.requestId)
  if (idx < 0) return state
  const existing = state.pendingPermissions[idx]!
  if (existing.resolution !== undefined) return state
  const nextPending = state.pendingPermissions.map((p, i) => (i === idx ? { ...p, resolution: e.decision } : p))
  const { messages, messageIndex } = updatePartEverywhere(
    state,
    (p) => p.type === 'permission' && p.requestId === e.requestId,
    (p) => ({ ...p, resolution: e.decision }) as Part,
  )
  return {
    ...state,
    pendingPermissions: nextPending,
    messages,
    messageIndex,
    session: {
      ...state.session,
      isWaitingOnUser: computeIsWaitingOnUser(nextPending, state.pendingQuestions),
    },
  }
}

// --- Question ----------------------------------------------------------------

function reduceQuestionRequested(state: ChatState, e: EventOfKind<AgentEvent, 'question.requested'>): ChatState {
  if (state.pendingQuestions.some((q) => q.questionId === e.questionId)) return state
  const entry: PendingQuestion = {
    questionId: e.questionId,
    request: e,
    arrivedAt: Date.now(),
  }
  const { state: s1, message, index, messageId } = getOrCreateActiveMessage(state, e.turnId)
  const newPart: Part = {
    type: 'question',
    questionId: e.questionId,
    question: e.question,
    options: e.options,
    allowFreeform: e.allowFreeform,
    index: message.parts.length,
  }
  const updated: UIMessage = { ...message, parts: [...message.parts, newPart] }
  const s2 = writeMessage(s1, index, updated)
  return {
    ...s2,
    pendingQuestions: [...state.pendingQuestions, entry],
    session: {
      ...s2.session,
      activeAssistantMessageId: messageId,
      isWaitingOnUser: true,
    },
  }
}

function reduceQuestionResolved(state: ChatState, e: EventOfKind<AgentEvent, 'question.resolved'>): ChatState {
  const idx = state.pendingQuestions.findIndex((q) => q.questionId === e.questionId)
  if (idx < 0) return state
  const existing = state.pendingQuestions[idx]!
  if (existing.answer !== undefined) return state
  const nextPending = state.pendingQuestions.map((q, i) => (i === idx ? { ...q, answer: e.answer } : q))
  const { messages, messageIndex } = updatePartEverywhere(
    state,
    (p) => p.type === 'question' && p.questionId === e.questionId,
    (p) => ({ ...p, answer: e.answer }) as Part,
  )
  return {
    ...state,
    pendingQuestions: nextPending,
    messages,
    messageIndex,
    session: {
      ...state.session,
      isWaitingOnUser: computeIsWaitingOnUser(state.pendingPermissions, nextPending),
    },
  }
}

// --- Mode / model / error ----------------------------------------------------

function reduceModeChanged(state: ChatState, e: EventOfKind<AgentEvent, 'mode.changed'>): ChatState {
  if (state.session.currentModeId === e.modeId) return state
  return { ...state, session: { ...state.session, currentModeId: e.modeId } }
}

function reduceModelChanged(state: ChatState, e: EventOfKind<AgentEvent, 'model.changed'>): ChatState {
  if (state.session.modelId === e.modelId) return state
  return { ...state, session: { ...state.session, modelId: e.modelId } }
}

function reduceReasoningEffortChanged(
  state: ChatState,
  e: EventOfKind<AgentEvent, 'reasoning.effort.changed'>,
): ChatState {
  if (state.session.reasoningEffort === e.reasoningEffort) return state
  return { ...state, session: { ...state.session, reasoningEffort: e.reasoningEffort } }
}

function reduceError(state: ChatState, e: EventOfKind<AgentEvent, 'error'>): ChatState {
  return {
    ...state,
    lastError: {
      code: e.code,
      message: e.message,
      recoverable: e.recoverable,
    },
  }
}

// --- Helpers ------------------------------------------------------------------

interface UpsertResult {
  readonly state: ChatState
  readonly message: UIMessage
  readonly index: number
}

function upsertMessage(state: ChatState, messageId: MessageId, role: UIMessage['role']): UpsertResult {
  const existing = state.messageIndex.get(messageId)
  if (existing !== undefined) {
    return { state, message: state.messages[existing]!, index: existing }
  }
  const message: UIMessage = {
    id: messageId,
    role,
    parts: [],
    createdAt: Date.now(),
  }
  const messages = [...state.messages, message]
  const nextIndex = new Map(state.messageIndex)
  nextIndex.set(messageId, messages.length - 1)
  return {
    state: { ...state, messages, messageIndex: nextIndex },
    message,
    index: messages.length - 1,
  }
}

/**
 * Get the active assistant message for the turn, or synthesize one if none
 * exists yet. Deterministic: the synthetic id is `auto:${turnId}` so replay
 * produces the same message.
 */
function getOrCreateActiveMessage(state: ChatState, turnId: string): UpsertResult & { messageId: MessageId } {
  const activeId = state.session.activeAssistantMessageId
  if (activeId) {
    const idx = state.messageIndex.get(activeId)
    if (idx !== undefined) {
      return { state, message: state.messages[idx]!, index: idx, messageId: activeId }
    }
  }
  const synth = `auto:${turnId}` as MessageId
  const { state: next, message, index } = upsertMessage(state, synth, 'assistant')
  return { state: next, message, index, messageId: synth }
}

function writeMessage(state: ChatState, index: number, message: UIMessage): ChatState {
  if (state.messages[index] === message) return state
  const messages = state.messages.map((m, i) => (i === index ? message : m))
  return { ...state, messages }
}

function replaceOrAppendPart(
  message: UIMessage,
  match: (p: Part) => boolean,
  build: (index: number) => Part,
): UIMessage {
  const existingIdx = message.parts.findIndex(match)
  if (existingIdx >= 0) {
    const existing = message.parts[existingIdx]!
    const next = build(existing.index)
    // Same-ref guard: if the built part deep-equals for plain fields, skip write.
    if (shallowEqualPart(existing, next)) return message
    const parts = message.parts.map((p, i) => (i === existingIdx ? next : p))
    return { ...message, parts }
  }
  const next = build(message.parts.length)
  return { ...message, parts: [...message.parts, next] }
}

function updatePartEverywhere(
  state: ChatState,
  match: (p: Part) => boolean,
  update: (p: Part) => Part,
): { messages: ReadonlyArray<UIMessage>; messageIndex: ReadonlyMap<MessageId, number> } {
  let changed = false
  const messages = state.messages.map((m) => {
    let localChanged = false
    const parts = m.parts.map((p) => {
      if (match(p)) {
        localChanged = true
        return update(p)
      }
      return p
    })
    if (!localChanged) return m
    changed = true
    return { ...m, parts }
  })
  if (!changed) return { messages: state.messages, messageIndex: state.messageIndex }
  return { messages, messageIndex: state.messageIndex }
}

interface FoundToolPart {
  readonly message: UIMessage
  readonly messageIndex: number
  readonly part: ToolPart
}

function findToolPart(state: ChatState, toolCallId: string): FoundToolPart | null {
  for (let i = 0; i < state.messages.length; i++) {
    const m = state.messages[i]!
    for (const p of m.parts) {
      if (p.type.startsWith('tool-') && 'toolCallId' in p && p.toolCallId === toolCallId) {
        return { message: m, messageIndex: i, part: p as FoundToolPart['part'] }
      }
    }
  }
  return null
}

const TOOL_STATUS_RANK: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
  cancelled: 3,
  failed: 4,
}

function mergeToolStatus<T extends string>(prev: T, next: T): T {
  const p = TOOL_STATUS_RANK[prev] ?? 0
  const n = TOOL_STATUS_RANK[next] ?? 0
  return n >= p ? next : prev
}

function computeIsWaitingOnUser(
  perms: ReadonlyArray<PendingPermission>,
  questions: ReadonlyArray<PendingQuestion>,
): boolean {
  return perms.some((p) => p.resolution === undefined) || questions.some((q) => q.answer === undefined)
}

function makeToolPart(args: {
  toolCallId: string
  toolKind: ToolKind
  status: ToolPart['status']
  title?: string
  detail?: ToolPart['detail']
  locations?: ToolPart['locations']
  index: number
}): Part {
  // Programmatic tool part construction; the Part schema has one variant per
  // kind and they all share the same shape.
  return {
    type: `tool-${args.toolKind}` as ToolPart['type'],
    toolCallId: args.toolCallId as ToolPart['toolCallId'],
    status: args.status,
    title: args.title,
    detail: args.detail,
    locations: args.locations,
    index: args.index,
  } as Part
}

function shallowEqualPart(a: Part, b: Part): boolean {
  if (a.type !== b.type) return false
  // Compare the fields that changed through build; good-enough equality check
  // to short-circuit no-ops without a deep-equal lib.
  if (a.type === 'text' && b.type === 'text') {
    return a.text === b.text && a.state === b.state
  }
  if (a.type === 'reasoning' && b.type === 'reasoning') {
    return a.text === b.text && a.state === b.state
  }
  return false
}
