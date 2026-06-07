import { describe, expect, it } from 'vitest'
import { InvalidTransitionError } from '../errors.ts'
import { assertTransition, canTransition, isTerminal } from '../state-machine.ts'
import type { TaskStatus } from '../types.ts'

describe('state-machine', () => {
  describe('canTransition', () => {
    const valid: [TaskStatus, TaskStatus][] = [
      ['draft', 'pending'],
      ['draft', 'ready'],
      ['pending', 'ready'],
      ['ready', 'in_progress'],
      ['in_progress', 'completed'],
      ['in_progress', 'failed'],
      ['in_progress', 'blocked'],
      ['in_progress', 'ready'],
      ['blocked', 'ready'],
      ['blocked', 'in_progress'],
      ['failed', 'ready'],
    ]

    for (const [from, to] of valid) {
      it(`allows ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(true)
      })
    }

    const invalid: [TaskStatus, TaskStatus][] = [
      ['draft', 'in_progress'],
      ['draft', 'completed'],
      ['draft', 'failed'],
      ['draft', 'blocked'],
      ['pending', 'in_progress'],
      ['pending', 'completed'],
      ['pending', 'draft'],
      ['ready', 'completed'],
      ['ready', 'draft'],
      ['ready', 'pending'],
      ['ready', 'blocked'],
      ['in_progress', 'draft'],
      ['in_progress', 'pending'],
      ['completed', 'ready'],
      ['completed', 'draft'],
      ['completed', 'in_progress'],
      ['completed', 'failed'],
      ['failed', 'in_progress'],
      ['failed', 'completed'],
      ['failed', 'draft'],
    ]

    for (const [from, to] of invalid) {
      it(`rejects ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(false)
      })
    }
  })

  describe('assertTransition', () => {
    it('does not throw for valid transitions', () => {
      expect(() => assertTransition('draft', 'ready')).not.toThrow()
    })

    it('throws InvalidTransitionError for invalid transitions', () => {
      expect(() => assertTransition('draft', 'completed')).toThrow(InvalidTransitionError)
    })

    it('error contains from/to', () => {
      try {
        assertTransition('ready', 'completed')
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidTransitionError)
        const err = e as InvalidTransitionError
        expect(err.from).toBe('ready')
        expect(err.to).toBe('completed')
      }
    })
  })

  describe('isTerminal', () => {
    it('completed is terminal', () => {
      expect(isTerminal('completed')).toBe(true)
    })

    it('other statuses are not terminal', () => {
      const nonTerminal: TaskStatus[] = ['draft', 'pending', 'ready', 'in_progress', 'blocked', 'failed']
      for (const status of nonTerminal) {
        expect(isTerminal(status)).toBe(false)
      }
    })
  })
})
