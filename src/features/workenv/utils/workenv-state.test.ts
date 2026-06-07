import { describe, expect, it } from 'vitest'
import type { WorkenvState } from '@/types/schema'
import {
  canDestroy,
  canStart,
  canStop,
  isTransitioning,
  WORKENV_STATE_BADGE_COLORS,
  WORKENV_STATE_DOT_COLORS,
  WORKENV_STATE_LABELS,
} from './workenv-state'

// Every value in the `WorkenvState` union — enumerated so new states
// can't slip past the completeness assertions below without surfacing
// a typecheck error here.
const ALL_STATES: readonly WorkenvState[] = [
  'creating',
  'stopped',
  'starting',
  'running',
  'stopping',
  'destroyed',
  'error',
  'stranded',
]

describe('canStart', () => {
  it('only allows start from stopped or error', () => {
    const allowed: WorkenvState[] = ['stopped', 'error']
    for (const s of ALL_STATES) {
      expect(canStart(s)).toBe(allowed.includes(s))
    }
  })
})

describe('canStop', () => {
  it('only allows stop while running', () => {
    for (const s of ALL_STATES) {
      expect(canStop(s)).toBe(s === 'running')
    }
  })

  it('does not allow stop mid-transition', () => {
    expect(canStop('starting')).toBe(false)
    expect(canStop('stopping')).toBe(false)
  })
})

describe('canDestroy', () => {
  it('allows destroy from any non-terminal state', () => {
    for (const s of ALL_STATES) {
      expect(canDestroy(s)).toBe(s !== 'destroyed')
    }
  })

  it('allows destroy from stranded (a recovery path)', () => {
    // Stranded workenvs are the primary motivator for permissive destroy:
    // the adapter's gone, so the user needs an out.
    expect(canDestroy('stranded')).toBe(true)
  })
})

describe('isTransitioning', () => {
  it('is true for creating/starting/stopping only', () => {
    const transitional: WorkenvState[] = ['creating', 'starting', 'stopping']
    for (const s of ALL_STATES) {
      expect(isTransitioning(s)).toBe(transitional.includes(s))
    }
  })

  it('is false for error/stranded (not actively transitioning)', () => {
    expect(isTransitioning('error')).toBe(false)
    expect(isTransitioning('stranded')).toBe(false)
  })
})

describe('WORKENV_STATE_LABELS', () => {
  it('has a human-readable label for every state', () => {
    for (const s of ALL_STATES) {
      expect(WORKENV_STATE_LABELS[s]).toBeTruthy()
      expect(WORKENV_STATE_LABELS[s].length).toBeGreaterThan(0)
    }
  })

  it('labels are title-cased (matches UI pill style)', () => {
    for (const s of ALL_STATES) {
      const label = WORKENV_STATE_LABELS[s]
      expect(label[0]).toBe(label[0]?.toUpperCase())
    }
  })
})

describe('WORKENV_STATE_DOT_COLORS', () => {
  it('has dot classes for every state', () => {
    for (const s of ALL_STATES) {
      expect(WORKENV_STATE_DOT_COLORS[s]).toBeTruthy()
    }
  })

  it('pulses on transitional states', () => {
    // Visual affordance — users should see motion while something's in
    // flight. Regression here would make starting/stopping feel stuck.
    expect(WORKENV_STATE_DOT_COLORS.creating).toMatch(/animate-pulse/)
    expect(WORKENV_STATE_DOT_COLORS.starting).toMatch(/animate-pulse/)
    expect(WORKENV_STATE_DOT_COLORS.stopping).toMatch(/animate-pulse/)
  })

  it('does not pulse on steady states', () => {
    expect(WORKENV_STATE_DOT_COLORS.running).not.toMatch(/animate-pulse/)
    expect(WORKENV_STATE_DOT_COLORS.stopped).not.toMatch(/animate-pulse/)
    expect(WORKENV_STATE_DOT_COLORS.error).not.toMatch(/animate-pulse/)
  })

  it('running is green', () => {
    expect(WORKENV_STATE_DOT_COLORS.running).toMatch(/emerald|green/)
  })

  it('error is red', () => {
    expect(WORKENV_STATE_DOT_COLORS.error).toMatch(/red/)
  })
})

describe('WORKENV_STATE_BADGE_COLORS', () => {
  it('has badge classes for every state', () => {
    for (const s of ALL_STATES) {
      expect(WORKENV_STATE_BADGE_COLORS[s]).toBeTruthy()
    }
  })

  it('badge classes include text + bg + border trio', () => {
    for (const s of ALL_STATES) {
      const cls = WORKENV_STATE_BADGE_COLORS[s]
      expect(cls).toMatch(/text-/)
      expect(cls).toMatch(/bg-/)
      expect(cls).toMatch(/border-/)
    }
  })
})
