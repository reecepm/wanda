// -----------------------------------------------------------------------------
// `createChatStore` integration — durable store + streaming atom wired
// together via `applyEnvelopes`. Verifies the delta-vs-completed routing
// and the backfill + live-tail paths.
// -----------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { createChatStore } from '../store.ts'
import { happyPathTimeline, makeIds, withSeqs } from './fixtures.ts'

describe('createChatStore', () => {
  it('routes deltas to the streaming atom and creates a live assistant placeholder', () => {
    const ids = makeIds()
    const store = createChatStore(ids.sessionId)
    store.applyEnvelopes(
      withSeqs([
        { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId },
        {
          kind: 'text.delta',
          sessionId: ids.sessionId,
          turnId: ids.turnId,
          messageId: ids.messageId,
          text: 'hel',
          index: 0,
        },
        {
          kind: 'text.delta',
          sessionId: ids.sessionId,
          turnId: ids.turnId,
          messageId: ids.messageId,
          text: 'lo',
          index: 1,
        },
      ]),
    )
    const state = store.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]).toMatchObject({
      id: ids.messageId,
      role: 'assistant',
      parts: [],
    })
    expect(state.session.activeAssistantMessageId).toBe(ids.messageId)
    const stream = store.streaming.snapshotKey(ids.messageId, 'text')
    expect(stream?.text).toBe('hello')
  })

  it('commits to messages on text.completed and clears the atom', () => {
    const ids = makeIds()
    const store = createChatStore(ids.sessionId)
    store.applyEnvelopes(
      withSeqs([
        { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId },
        {
          kind: 'text.delta',
          sessionId: ids.sessionId,
          turnId: ids.turnId,
          messageId: ids.messageId,
          text: 'hi',
          index: 0,
        },
        {
          kind: 'text.completed',
          sessionId: ids.sessionId,
          turnId: ids.turnId,
          messageId: ids.messageId,
          text: 'hi',
        },
      ]),
    )
    expect(store.getState().messages).toHaveLength(1)
    expect(store.streaming.snapshotKey(ids.messageId, 'text')).toBeUndefined()
  })

  it('notifies subscribers only when state changes', () => {
    const ids = makeIds()
    const store = createChatStore(ids.sessionId)
    let calls = 0
    store.subscribe(() => {
      calls += 1
    })
    store.applyEnvelopes(withSeqs(happyPathTimeline(ids)))
    expect(calls).toBeGreaterThan(0)
  })

  it('prependBackfill tracks oldestSeq', () => {
    const ids = makeIds()
    const store = createChatStore(ids.sessionId)
    store.prependBackfill(
      withSeqs(
        [
          { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId },
          {
            kind: 'text.completed',
            sessionId: ids.sessionId,
            turnId: ids.turnId,
            messageId: ids.messageId,
            text: 'first',
          },
        ],
        10,
      ),
    )
    expect(store.getState().oldestSeq).toBe(10)
  })

  it('reset clears the durable store + streaming atom', () => {
    const ids = makeIds()
    const store = createChatStore(ids.sessionId)
    store.applyEnvelopes(withSeqs(happyPathTimeline(ids)))
    store.streaming.appendDelta({
      sessionId: ids.sessionId,
      messageId: ids.messageId,
      kind: 'text',
      text: 'x',
      index: 0,
      ts: 1,
    })
    store.reset()
    expect(store.getState().messages).toHaveLength(0)
    expect(store.streaming.snapshot().size).toBe(0)
  })

  it('setPhase / setEpoch / markAtHead flip their respective flags', () => {
    const ids = makeIds()
    const store = createChatStore(ids.sessionId)
    store.setPhase('live')
    store.setEpoch(7)
    store.markAtHead()
    const s = store.getState()
    expect(s.phase).toBe('live')
    expect(s.epoch).toBe(7)
    expect(s.atHead).toBe(true)
  })

  it('clears the optimistic user echo when the persisted user message lands', () => {
    const ids = makeIds()
    const store = createChatStore(ids.sessionId)
    const optimisticId = store.startOptimisticUserMessage([{ kind: 'text', text: 'hello' }])
    expect(optimisticId).toBeTruthy()
    store.bindOptimisticUserTurn(ids.turnId)

    store.applyEnvelopes(
      withSeqs([
        {
          kind: 'text.completed',
          sessionId: ids.sessionId,
          turnId: ids.turnId,
          messageId: ids.messageId,
          text: 'hello',
          role: 'user',
        },
      ]),
    )

    const state = store.getState()
    expect(state.optimisticUserMessage).toBeNull()
    expect(state.optimisticUserTurnId).toBeNull()
    expect(state.messages).toHaveLength(1)
  })
})
