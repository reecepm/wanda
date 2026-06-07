// -----------------------------------------------------------------------------
// Pure-data coverage for the state machine: legal-transition table,
// `canTransition`, and terminal-state semantics.
// -----------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { canTransition, isTerminal, LEGAL_TRANSITIONS, type SessionStateTag } from '../state-machine.ts'

const ALL_TAGS: ReadonlyArray<SessionStateTag> = ['cold', 'starting', 'ready', 'running', 'error', 'closed']

describe('state machine', () => {
  it('allows every transition in the legal table', () => {
    for (const t of LEGAL_TRANSITIONS) {
      expect(canTransition(t.from, t.to)).toBe(true)
    }
  })

  it('forbids self-loops that are not in the table', () => {
    for (const tag of ALL_TAGS) {
      expect(canTransition(tag, tag)).toBe(false)
    }
  })

  it('cannot transition out of closed (terminal)', () => {
    expect(isTerminal('closed')).toBe(true)
    for (const tag of ALL_TAGS) {
      if (tag === 'closed') continue
      expect(canTransition('closed', tag)).toBe(false)
    }
  })

  it('allows the core happy path cold → starting → ready → running → ready', () => {
    expect(canTransition('cold', 'starting')).toBe(true)
    expect(canTransition('starting', 'ready')).toBe(true)
    expect(canTransition('ready', 'running')).toBe(true)
    expect(canTransition('running', 'ready')).toBe(true)
  })

  it('allows eviction (ready → cold) and resurrection from error', () => {
    expect(canTransition('ready', 'cold')).toBe(true)
    expect(canTransition('error', 'starting')).toBe(true)
  })

  it('never hops from running directly to starting (must land in ready or error first)', () => {
    expect(canTransition('running', 'starting')).toBe(false)
  })

  it('rejects illegal cold → running (must spawn first)', () => {
    expect(canTransition('cold', 'running')).toBe(false)
  })
})
