// -----------------------------------------------------------------------------
// Seq-based dedup applier — the handshake rule from 04 §3.
//
// Envelopes are applied iff their `seq > state.appliedSeq`. Live tail and
// replay page share a single applier so the subscribe-first-then-replay
// handshake fuses into the store without gaps or duplicates.
// -----------------------------------------------------------------------------

import type { AgentEvent } from '@wanda/agent-protocol'
import { reduce } from './reducer.ts'
import type { ChatState } from './state.ts'

export interface EnvelopeLike {
  readonly seq: number
  readonly payload: AgentEvent
}

export function applyEnvelope(state: ChatState, env: EnvelopeLike): ChatState {
  if (env.seq <= state.appliedSeq) return state
  const next = reduce(state, env.payload)
  // If the reducer returned the same reference, only bump the cursor.
  if (next === state) return { ...state, appliedSeq: env.seq }
  return { ...next, appliedSeq: env.seq }
}
