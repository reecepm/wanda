import { describe, expect, it } from 'vitest'
import type { WorkenvState } from '../../../../../shared/contracts/workenv'
import { assertTransition, canTransition, InvalidTransitionError, isTerminal, nextStates } from '../lifecycle'

const ALL_STATES: WorkenvState[] = [
  'creating',
  'stopped',
  'starting',
  'running',
  'stopping',
  'destroyed',
  'error',
  'stranded',
]

describe('workenv lifecycle state machine', () => {
  describe('happy path transitions', () => {
    it.each([
      ['creating', 'stopped'],
      ['stopped', 'starting'],
      ['starting', 'running'],
      ['running', 'stopping'],
      ['stopping', 'stopped'],
      ['stopped', 'destroyed'],
    ] as const)('allows %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(true)
    })
  })

  describe('error and stranded are reachable from any other non-terminal state', () => {
    it.each([
      'creating',
      'stopped',
      'starting',
      'running',
      'stopping',
      'stranded',
    ] as const)('allows %s → error', (from) => {
      expect(canTransition(from, 'error')).toBe(true)
    })
    it.each([
      'creating',
      'stopped',
      'starting',
      'running',
      'stopping',
      'error',
    ] as const)('allows %s → stranded', (from) => {
      expect(canTransition(from, 'stranded')).toBe(true)
    })
  })

  describe('error recovery', () => {
    it('error → starting (retry start)', () => {
      expect(canTransition('error', 'starting')).toBe(true)
    })
    it('error → stopped (retry stop / acknowledge)', () => {
      expect(canTransition('error', 'stopped')).toBe(true)
    })
    it('error → destroyed (give up, delete)', () => {
      expect(canTransition('error', 'destroyed')).toBe(true)
    })
  })

  describe('stranded recovery', () => {
    it('stranded → destroyed (only way out)', () => {
      expect(canTransition('stranded', 'destroyed')).toBe(true)
    })
    it('stranded → starting is rejected (must reinstall adapter first → reset to stopped)', () => {
      expect(canTransition('stranded', 'starting')).toBe(false)
    })
    it('stranded → stopped (after operator reinstalls the runtime)', () => {
      expect(canTransition('stranded', 'stopped')).toBe(true)
    })
  })

  describe('invalid transitions', () => {
    it.each([
      ['creating', 'running'],
      ['stopped', 'running'],
      ['stopped', 'stopping'],
      ['starting', 'stopped'],
      ['running', 'starting'],
      ['stopping', 'running'],
      ['stopping', 'destroyed'],
      ['stopping', 'starting'],
    ] as const)('rejects %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(false)
    })

    it('rejects same-state self-loop transitions', () => {
      for (const s of ALL_STATES) {
        expect(canTransition(s, s)).toBe(false)
      }
    })
  })

  describe('terminal states', () => {
    it('destroyed is terminal — no transitions out', () => {
      expect(isTerminal('destroyed')).toBe(true)
      for (const to of ALL_STATES) {
        expect(canTransition('destroyed', to)).toBe(false)
      }
    })

    it('every other state is non-terminal', () => {
      const nonTerminal = ALL_STATES.filter((s) => s !== 'destroyed')
      for (const s of nonTerminal) {
        expect(isTerminal(s)).toBe(false)
      }
    })
  })

  describe('assertTransition', () => {
    it('returns silently on a valid transition', () => {
      expect(() => assertTransition('stopped', 'starting')).not.toThrow()
    })

    it('throws InvalidTransitionError on an invalid transition', () => {
      expect(() => assertTransition('stopped', 'running')).toThrow(InvalidTransitionError)
    })

    it('error message names both states', () => {
      try {
        assertTransition('destroyed', 'starting')
      } catch (err) {
        expect((err as Error).message).toContain('destroyed')
        expect((err as Error).message).toContain('starting')
        return
      }
      throw new Error('expected throw')
    })
  })

  describe('nextStates', () => {
    it('returns the set of legal successors for a given state', () => {
      const fromStopped = nextStates('stopped').sort()
      expect(fromStopped).toContain('starting')
      expect(fromStopped).toContain('destroyed')
      expect(fromStopped).toContain('error')
      expect(fromStopped).toContain('stranded')
      expect(fromStopped).not.toContain('running')
    })

    it('returns empty array for terminal state', () => {
      expect(nextStates('destroyed')).toEqual([])
    })
  })
})
