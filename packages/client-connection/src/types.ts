// -----------------------------------------------------------------------------
// Public types for @wanda/client-connection.
// -----------------------------------------------------------------------------

import type { Envelope, HelloRejectedReason } from '@wanda/wire'

export const CONNECTION_STATES = [
  'idle',
  'connecting',
  'connected',
  'recovering',
  'reconnecting',
  'offline',
  'unpaired',
  'stopped',
] as const

export type ConnectionState = (typeof CONNECTION_STATES)[number]

/** Cursor the client stores to resume after a disconnect. */
export interface ResumeCursor {
  /** Last event seq this client's store has applied, or 0 if none. */
  readonly seq: number
  /** Last server epoch the client observed, or null if never handshaked. */
  readonly epoch: number | null
}

/**
 * Test-injectable WebSocket factory. The runtime default is `new WebSocket(url)`
 * from the browser or Node's `ws` package (consumer-supplied). Tests pass in a
 * hand-rolled mock that exposes open / message / close / error hooks.
 */
export interface MinimalWebSocket {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(type: 'message', listener: (ev: { data: string | ArrayBuffer }) => void): void
  addEventListener(type: 'close', listener: (ev: { code: number; reason: string }) => void): void
  addEventListener(type: 'error', listener: (ev: unknown) => void): void
  removeEventListener(type: string, listener: (...args: never[]) => void): void
}

export type WebSocketFactory = (url: string) => MinimalWebSocket

/**
 * The ClientConnection is framework-agnostic. It doesn't know about Zustand
 * or TanStack Query; it exposes hooks that the store layer implements.
 */
export interface ClientConnectionCallbacks {
  /** Fired on every state transition. Idempotent on identical transitions. */
  onStateChange?(state: ConnectionState): void
  /** Fired for every `event:*` envelope — both live and replayed. The store
   *  applier decides what to do; the connection does not inspect payloads. */
  onEventEnvelope?(envelope: Envelope): void
  /**
   * Fired for envelopes whose channel isn't `sys:*` and isn't `event:*`.
   * Covers grandfathered legacy namespaces (`pod:*`, `git:*`, `agent:*`,
   * `terminal:*`, `orpc:invalidate`, etc.) that the server's firehose
   * subscription still fans out. Consumers building against the new
   * per-resource subscription model should prefer `onEventEnvelope`; this
   * hook exists so the renderer's listener registry can keep working while
   * channels are progressively migrated.
   */
  onLegacyEnvelope?(envelope: Envelope): void
  /** Fired for `sys:subscribed` acks so the store can correlate request ids. */
  onSubscribed?(envelope: Envelope): void
  /** Fired for scoped replay completions while the connection is already ready. */
  onReplayComplete?(envelope: Envelope): void
  /** Fired for scoped replay failures while the connection is already ready. */
  onReplayGone?(envelope: Envelope): void
  /** Fired when a replay is requested and the server answered `sys:replay-gone`
   *  OR the epoch changed on reconnect. The store is expected to drop cached
   *  domain state and refetch snapshots. Returns once the resync finishes. */
  onFullResyncNeeded?(reason: 'replay-gone' | 'epoch-changed', meta: { serverId: string; epoch: number }): Promise<void>
  /** Fired once per reconnect cycle after replay + full-resync have finished.
   *  The store re-emits subscribe calls here. */
  onReady?(): void | Promise<void>
  /** Fired when the server replies `sys:hello-rejected`. The store should
   *  surface an app-facing dialog and stop retrying. */
  onHelloRejected?(reason: HelloRejectedReason): void
}
