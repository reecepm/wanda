// -----------------------------------------------------------------------------
// Workenv lifecycle state machine.
//
//   creating → stopped → starting → running → stopping → stopped
//                                                │
//                                                └→ destroyed
//   any → error      (recoverable; retry from error)
//   any → stranded   (runtime uninstalled / adapter missing; UI read-only)
//
// Guards live here; the controller calls assertTransition() before any
// state column write. `destroyed` is terminal — once a workenv lands
// there, no further transition is legal (the row is GC-able).
// -----------------------------------------------------------------------------

import type { WorkenvState } from '../../../../shared/contracts/workenv'

export class InvalidTransitionError extends Error {
  readonly from: WorkenvState
  readonly to: WorkenvState
  constructor(from: WorkenvState, to: WorkenvState) {
    super(`Invalid workenv state transition: ${from} → ${to}`)
    this.name = 'InvalidTransitionError'
    this.from = from
    this.to = to
  }
}

const TERMINAL: ReadonlySet<WorkenvState> = new Set(['destroyed'])

/**
 * Map of explicit (from → allowed-to) edges. `error` and `stranded` are
 * not listed as targets here — they're added uniformly via the "any →"
 * rule below.
 */
const EDGES: Readonly<Record<WorkenvState, ReadonlySet<WorkenvState>>> = {
  creating: new Set(['stopped']),
  stopped: new Set(['starting', 'destroyed']),
  starting: new Set(['running']),
  running: new Set(['stopping', 'destroyed']),
  stopping: new Set(['stopped']),
  destroyed: new Set(),
  // Recovery from error: retry start, acknowledge as stopped, or give up.
  error: new Set(['starting', 'stopped', 'destroyed']),
  // Stranded: only resolvable by reinstalling the runtime (→ stopped) or
  // deleting the workenv. UI gates everything else.
  stranded: new Set(['stopped', 'destroyed']),
}

/**
 * Universal targets reachable from any non-terminal state. `error` is
 * also allowed from `error` itself (a different error class supersedes
 * the previous one).
 */
const UNIVERSAL_TARGETS: ReadonlySet<WorkenvState> = new Set(['error', 'stranded'])

export function isTerminal(state: WorkenvState): boolean {
  return TERMINAL.has(state)
}

export function canTransition(from: WorkenvState, to: WorkenvState): boolean {
  if (from === to) return false
  if (isTerminal(from)) return false
  if (UNIVERSAL_TARGETS.has(to)) {
    // error/stranded reachable from any non-terminal source.
    return true
  }
  return EDGES[from].has(to)
}

export function assertTransition(from: WorkenvState, to: WorkenvState): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to)
  }
}

export function nextStates(from: WorkenvState): WorkenvState[] {
  if (isTerminal(from)) return []
  const explicit = Array.from(EDGES[from])
  // Universal targets — only include if not already there and not the same state.
  const universal = Array.from(UNIVERSAL_TARGETS).filter((s) => s !== from && !explicit.includes(s))
  return [...explicit, ...universal]
}
