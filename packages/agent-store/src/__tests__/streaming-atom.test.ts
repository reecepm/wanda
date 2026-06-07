// -----------------------------------------------------------------------------
// StreamingAtom coverage: append / complete / clear / flush-scheduling.
// -----------------------------------------------------------------------------

import { newMessageId, newSessionId } from '@wanda/agent-protocol'
import { describe, expect, it } from 'vitest'
import { StreamingAtom } from '../streaming-atom.ts'

describe('StreamingAtom', () => {
  it('accumulates deltas into a single concatenated text', () => {
    const atom = new StreamingAtom()
    const sessionId = newSessionId()
    const messageId = newMessageId()
    atom.appendDelta({ sessionId, messageId, kind: 'text', text: 'hel', index: 0, ts: 1 })
    atom.appendDelta({ sessionId, messageId, kind: 'text', text: 'lo', index: 1, ts: 2 })
    const part = atom.snapshotKey(messageId, 'text')
    expect(part?.text).toBe('hello')
    expect(part?.lastIndex).toBe(1)
    expect(part?.firstDeltaAt).toBe(1)
    expect(part?.lastDeltaAt).toBe(2)
  })

  it('keeps reasoning and text under distinct keys', () => {
    const atom = new StreamingAtom()
    const sessionId = newSessionId()
    const messageId = newMessageId()
    atom.appendDelta({ sessionId, messageId, kind: 'text', text: 'a', index: 0, ts: 1 })
    atom.appendDelta({ sessionId, messageId, kind: 'reasoning', text: 'b', index: 0, ts: 2 })
    expect(atom.snapshotKey(messageId, 'text')?.text).toBe('a')
    expect(atom.snapshotKey(messageId, 'reasoning')?.text).toBe('b')
  })

  it('complete() removes the entry', () => {
    const atom = new StreamingAtom()
    const sessionId = newSessionId()
    const messageId = newMessageId()
    atom.appendDelta({ sessionId, messageId, kind: 'text', text: 'x', index: 0, ts: 1 })
    atom.complete(messageId, 'text')
    expect(atom.snapshotKey(messageId, 'text')).toBeUndefined()
  })

  it('notifies subscribers on flush', () => {
    const atom = new StreamingAtom()
    let calls = 0
    const unsubscribe = atom.subscribe(() => {
      calls += 1
    })
    const sessionId = newSessionId()
    const messageId = newMessageId()
    atom.appendDelta({ sessionId, messageId, kind: 'text', text: 'a', index: 0, ts: 1 })
    atom.flushNow()
    expect(calls).toBe(1)
    unsubscribe()
  })

  it('subscribers can unsubscribe mid-flush without breaking others', () => {
    const atom = new StreamingAtom()
    const order: string[] = []
    atom.subscribe(() => order.push('a'))
    const unsubB = atom.subscribe(() => {
      order.push('b')
      unsubB()
    })
    atom.subscribe(() => order.push('c'))
    atom.flushNow()
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('clear() empties all entries', () => {
    const atom = new StreamingAtom()
    const sessionId = newSessionId()
    const messageId = newMessageId()
    atom.appendDelta({ sessionId, messageId, kind: 'text', text: 'x', index: 0, ts: 1 })
    atom.clear()
    expect(atom.snapshot().size).toBe(0)
  })
})
