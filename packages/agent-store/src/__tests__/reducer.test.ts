// -----------------------------------------------------------------------------
// Reducer coverage. Drives scripted AgentEvent timelines through `reduce` and
// asserts on ChatState transitions + idempotence.
// -----------------------------------------------------------------------------

import type { AgentEvent, MessageId, Part, PermissionRequest, QuestionAnswer } from '@wanda/agent-protocol'
import { describe, expect, it } from 'vitest'
import { applyEnvelope } from '../dedup.ts'
import { reduce } from '../reducer.ts'
import { initialChatState } from '../state.ts'
import { DEFAULT_CAPABILITIES, happyPathTimeline, makeIds, withSeqs } from './fixtures.ts'

describe('reducer — happy path', () => {
  it('walks session.started → turn → text.completed → turn.completed', () => {
    const ids = makeIds()
    let state = initialChatState(ids.sessionId)
    for (const e of happyPathTimeline(ids)) state = reduce(state, e)

    expect(state.session.status).toBe('ready')
    expect(state.session.activeTurnId).toBe(null)
    expect(state.session.capabilities).toEqual(DEFAULT_CAPABILITIES)
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]!.id).toBe(ids.messageId)
    expect(state.messages[0]!.parts).toHaveLength(1)
    expect(state.messages[0]!.parts[0]).toMatchObject({ type: 'text', text: 'hello world', state: 'done' })
    expect(state.turns[ids.turnId]!.status).toBe('completed')
  })

  it('session.closed stops the session and clears active turn state', () => {
    const ids = makeIds()
    let state = initialChatState(ids.sessionId)
    state = reduce(state, { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId })
    state = reduce(state, {
      kind: 'session.closed',
      sessionId: ids.sessionId,
      reason: 'user',
    })
    expect(state.session.status).toBe('closed')
    expect(state.session.closedReason).toBe('user')
    expect(state.session.activeTurnId).toBe(null)
    expect(state.session.activeAssistantMessageId).toBe(null)
    expect(state.session.isWaitingOnUser).toBe(false)
  })
})

describe('reducer — tool lifecycle + lattice', () => {
  it('tool.started creates a part on the current assistant message', () => {
    const ids = makeIds()
    let state = initialChatState(ids.sessionId)
    state = reduce(state, { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId })
    state = reduce(state, {
      kind: 'tool.started',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      toolCallId: ids.toolCallId,
      toolKind: 'execute',
      title: 'bun test',
    })
    expect(state.messages).toHaveLength(1)
    const part = state.messages[0]!.parts[0]!
    expect(part.type).toBe('tool-execute')
    expect('toolCallId' in part && part.toolCallId).toBe(ids.toolCallId)
    expect('status' in part && part.status).toBe('in_progress')
  })

  it('tool.updated never downgrades status', () => {
    const ids = makeIds()
    let state = initialChatState(ids.sessionId)
    state = reduce(state, { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId })
    state = reduce(state, {
      kind: 'tool.started',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      toolCallId: ids.toolCallId,
      toolKind: 'read',
    })
    state = reduce(state, {
      kind: 'tool.completed',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      toolCallId: ids.toolCallId,
      status: 'completed',
    })
    // Out-of-order updated with a lower-rank status should NOT downgrade.
    state = reduce(state, {
      kind: 'tool.updated',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      toolCallId: ids.toolCallId,
      status: 'in_progress',
    })
    const part = state.messages[0]!.parts[0]!
    expect('status' in part && part.status).toBe('completed')
  })

  it('failed > cancelled > completed > in_progress > pending', () => {
    const ids = makeIds()
    let state = initialChatState(ids.sessionId)
    state = reduce(state, { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId })
    state = reduce(state, {
      kind: 'tool.started',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      toolCallId: ids.toolCallId,
      toolKind: 'execute',
    })
    state = reduce(state, {
      kind: 'tool.completed',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      toolCallId: ids.toolCallId,
      status: 'failed',
    })
    const part = state.messages[0]!.parts[0]!
    expect('status' in part && part.status).toBe('failed')
  })

  it('idempotent tool.started (no duplicate part on replay)', () => {
    const ids = makeIds()
    let state = initialChatState(ids.sessionId)
    state = reduce(state, { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId })
    const toolStart: AgentEvent = {
      kind: 'tool.started',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      toolCallId: ids.toolCallId,
      toolKind: 'read',
    }
    state = reduce(state, toolStart)
    const after = reduce(state, toolStart)
    expect(after).toBe(state)
    expect(state.messages[0]!.parts).toHaveLength(1)
  })
})

describe('reducer — permission + question', () => {
  it('permission.requested puts an entry + part and flips isWaitingOnUser', () => {
    const ids = makeIds()
    const request: PermissionRequest = {
      kind: 'other',
      title: 'confirm',
      description: 'please',
    }
    let state = initialChatState(ids.sessionId)
    state = reduce(state, { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId })
    state = reduce(state, {
      kind: 'permission.requested',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      requestId: ids.requestId,
      request,
      timeoutAt: 1_700_000_000_000,
    })
    expect(state.pendingPermissions).toHaveLength(1)
    expect(state.pendingPermissions[0]!.timeoutAt).toBe(1_700_000_000_000)
    expect(state.session.isWaitingOnUser).toBe(true)
    const part = state.messages[0]!.parts[0]!
    expect(part.type).toBe('permission')
  })

  it('permission.resolved attaches decision and clears waiting flag', () => {
    const ids = makeIds()
    const request: PermissionRequest = { kind: 'other', title: 'ok?' }
    let state = initialChatState(ids.sessionId)
    state = reduce(state, { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId })
    state = reduce(state, {
      kind: 'permission.requested',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      requestId: ids.requestId,
      request,
    })
    state = reduce(state, {
      kind: 'permission.resolved',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      requestId: ids.requestId,
      decision: { behaviour: 'allow', scope: 'session' },
    })
    expect(state.session.isWaitingOnUser).toBe(false)
    expect(state.pendingPermissions[0]!.resolution).toMatchObject({ behaviour: 'allow', scope: 'session' })
    const part = state.messages[0]!.parts[0]!
    expect(part.type === 'permission' && part.resolution?.behaviour).toBe('allow')
  })

  it('question.resolved stores QuestionAnswer + clears waiting', () => {
    const ids = makeIds()
    let state = initialChatState(ids.sessionId)
    state = reduce(state, { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId })
    state = reduce(state, {
      kind: 'question.requested',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      questionId: ids.questionId,
      question: 'confirm?',
      options: [{ id: 'y', label: 'Yes' }],
      allowFreeform: false,
    })
    const answer: QuestionAnswer = { kind: 'option', optionId: 'y' }
    state = reduce(state, {
      kind: 'question.resolved',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      questionId: ids.questionId,
      answer,
    })
    expect(state.pendingQuestions[0]!.answer).toEqual(answer)
    expect(state.session.isWaitingOnUser).toBe(false)
  })

  it('isWaitingOnUser stays true while any request is unresolved', () => {
    const ids = makeIds()
    let state = initialChatState(ids.sessionId)
    state = reduce(state, { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId })
    state = reduce(state, {
      kind: 'permission.requested',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      requestId: ids.requestId,
      request: { kind: 'other', title: 'a' },
    })
    state = reduce(state, {
      kind: 'question.requested',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      questionId: ids.questionId,
      question: 'b',
      allowFreeform: false,
    })
    state = reduce(state, {
      kind: 'permission.resolved',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      requestId: ids.requestId,
      decision: { behaviour: 'deny', scope: 'once' },
    })
    expect(state.session.isWaitingOnUser).toBe(true) // question still pending
  })
})

describe('reducer — plan / mode / model / error', () => {
  it('plan.updated replaces plan wholesale', () => {
    const ids = makeIds()
    let state = initialChatState(ids.sessionId)
    state = reduce(state, {
      kind: 'plan.updated',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      plan: [
        {
          id: ids.planItemId as Parameters<typeof reduce>[1] extends { plan: infer P } ? never : never,
          title: 'step',
          status: 'pending',
          dependsOn: [],
        },
      ] as never,
    })
    expect(state.plan).toHaveLength(1)
    expect(state.hasActivePlan).toBe(true)
  })

  it('mode.changed returns the same reference when idempotent', () => {
    const ids = makeIds()
    let state = initialChatState(ids.sessionId)
    state = reduce(state, {
      kind: 'session.started',
      sessionId: ids.sessionId,
      providerId: ids.providerId,
      capabilities: DEFAULT_CAPABILITIES,
      modes: [],
      modelOptions: [],
      currentModeId: ids.modeId,
    })
    const before = state
    const after = reduce(state, { kind: 'mode.changed', sessionId: ids.sessionId, modeId: ids.modeId })
    expect(after).toBe(before)
  })

  it('error stores lastError without throwing', () => {
    const ids = makeIds()
    const state = reduce(initialChatState(ids.sessionId), {
      kind: 'error',
      sessionId: ids.sessionId,
      message: 'boom',
      recoverable: false,
      code: 'PROVIDER_EXITED',
    })
    expect(state.lastError).toMatchObject({ message: 'boom', code: 'PROVIDER_EXITED', recoverable: false })
  })
})

describe('applyEnvelope — seq dedup', () => {
  it('skips envelopes with seq ≤ appliedSeq', () => {
    const ids = makeIds()
    let state = initialChatState(ids.sessionId)
    const [first, second] = withSeqs([
      { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId },
      { kind: 'turn.completed', sessionId: ids.sessionId, turnId: ids.turnId, stopReason: 'end_turn' },
    ])
    state = applyEnvelope(state, first!)
    state = applyEnvelope(state, second!)
    expect(state.appliedSeq).toBe(2)

    // Re-applying the same envelopes is a no-op on the core state (both state
    // and appliedSeq stay put; the envelope seq guard rejects the event).
    const snapshot = state
    state = applyEnvelope(state, first!)
    expect(state).toBe(snapshot)
  })

  it('bumps appliedSeq even when the event is a no-op (e.g. text.delta)', () => {
    const ids = makeIds()
    const msgId = ids.messageId as MessageId
    let state = initialChatState(ids.sessionId)
    state = { ...state, appliedSeq: 0 }
    const env = {
      seq: 1,
      payload: {
        kind: 'text.delta',
        sessionId: ids.sessionId,
        turnId: ids.turnId,
        messageId: msgId,
        text: 'a',
        index: 0,
      } satisfies AgentEvent,
    }
    const next = applyEnvelope(state, env)
    expect(next.appliedSeq).toBe(1)
    expect(next.messages).toBe(state.messages) // delta isn't persisted
  })
})

describe('reducer — forward-compat', () => {
  it('unknown event kind is a no-op', () => {
    const ids = makeIds()
    const state = initialChatState(ids.sessionId)
    const fake = { kind: 'future.kind', sessionId: ids.sessionId } as unknown as AgentEvent
    expect(reduce(state, fake)).toBe(state)
  })
})

describe('reducer — part ordering', () => {
  it('parts carry monotonic indices across tool + permission additions', () => {
    const ids = makeIds()
    let state = initialChatState(ids.sessionId)
    state = reduce(state, { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId })
    state = reduce(state, {
      kind: 'tool.started',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      toolCallId: ids.toolCallId,
      toolKind: 'execute',
    })
    state = reduce(state, {
      kind: 'permission.requested',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      requestId: ids.requestId,
      request: { kind: 'other', title: 'ok?' },
    })
    const indices = state.messages[0]!.parts.map((p: Part) => p.index)
    expect(indices).toEqual([0, 1])
  })
})
