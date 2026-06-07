// -----------------------------------------------------------------------------
// @wanda/agent-store — pure reducer + streaming atom + per-session store.
//
// No React; framework-agnostic. Consumers wire `useSyncExternalStore` against
// `ChatStoreHandle.subscribe` and `.streaming.subscribe`.
// -----------------------------------------------------------------------------

export type { EnvelopeLike } from './dedup.ts'
export { applyEnvelope } from './dedup.ts'
// Reducer / pure-data surface
export { reduce } from './reducer.ts'
export type {
  ChatState,
  PendingPermission,
  PendingQuestion,
  SessionPhase,
  SessionSlice,
  TurnSlice,
  Usage,
} from './state.ts'
// State shape
export { initialChatState } from './state.ts'
export type { ChatStoreHandle } from './store.ts'
// Per-session store facade
export { createChatStore } from './store.ts'
export type { StreamingPart, StreamKind } from './streaming-atom.ts'
// Streaming atom
export { StreamingAtom } from './streaming-atom.ts'
