// -----------------------------------------------------------------------------
// Session state machine.
//
// Pure data — the full `SessionState` shape (with Fiber, stderrTail) is the
// concern of `ManagedSession` (constructed by the runtime). This file holds
// only the tags + legal transition table so tests can exercise the machine
// without a live runtime.
// -----------------------------------------------------------------------------

import type { TurnId } from '@wanda/agent-protocol'

export type SessionStateTag = 'cold' | 'starting' | 'ready' | 'running' | 'error' | 'closed'

/**
 * Narrow `SessionState` variants that don't depend on Effect runtime types.
 * `ManagedSession` extends the `running` variant with a `Fiber.RuntimeFiber`
 * at construction time; that lives in `managed-session.ts`, not here.
 */
export type SessionState =
  | { readonly tag: 'cold' }
  | { readonly tag: 'starting'; readonly since: number }
  | { readonly tag: 'ready'; readonly readySince: number }
  | { readonly tag: 'running'; readonly turnId: TurnId; readonly startedAt: number }
  | {
      readonly tag: 'error'
      readonly at: number
      readonly message: string
      readonly recoverable: boolean
      readonly stderrTail?: string
    }
  | {
      readonly tag: 'closed'
      readonly at: number
      readonly reason: 'user' | 'idle' | 'crashed' | 'archived' | 'server_shutdown'
    }

export interface StateTransition {
  readonly from: SessionStateTag
  readonly to: SessionStateTag
  readonly trigger: string
}

export const LEGAL_TRANSITIONS: ReadonlyArray<StateTransition> = [
  { from: 'cold', to: 'starting', trigger: 'create() | attach() | prompt() after eviction' },
  { from: 'starting', to: 'ready', trigger: 'handshake success' },
  { from: 'starting', to: 'error', trigger: 'handshake fail / spawn throw' },
  { from: 'starting', to: 'closed', trigger: 'close() during start' },
  { from: 'ready', to: 'running', trigger: 'prompt()' },
  { from: 'ready', to: 'closed', trigger: 'close() / archive() / TTL eviction' },
  { from: 'ready', to: 'cold', trigger: 'TTL eviction (with resume capability)' },
  { from: 'ready', to: 'error', trigger: 'provider crash while idle' },
  { from: 'running', to: 'ready', trigger: 'turn.completed | turn.cancelled' },
  { from: 'running', to: 'error', trigger: 'provider crash mid-turn' },
  { from: 'running', to: 'closed', trigger: 'close() — force cancels turn' },
  { from: 'error', to: 'starting', trigger: 'prompt() / attach() user-triggered resume' },
  { from: 'error', to: 'running', trigger: 'prompt() retry — provider session alive, no handshake' },
  { from: 'error', to: 'ready', trigger: 'provider self-heals between turns' },
  { from: 'error', to: 'closed', trigger: 'close()' },
]

export function canTransition(from: SessionStateTag, to: SessionStateTag): boolean {
  return LEGAL_TRANSITIONS.some((t) => t.from === from && t.to === to)
}

/**
 * Derived: terminal states cannot be transitioned out of. Currently only
 * `closed` — a "closed" session is resurrected by creating a new
 * ManagedSession for the same DB row, not by transitioning.
 */
export const TERMINAL_STATES: ReadonlySet<SessionStateTag> = new Set(['closed'])

export function isTerminal(tag: SessionStateTag): boolean {
  return TERMINAL_STATES.has(tag)
}
