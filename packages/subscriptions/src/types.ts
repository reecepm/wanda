// -----------------------------------------------------------------------------
// Public types for @wanda/subscriptions.
// -----------------------------------------------------------------------------

import type { Envelope } from '@wanda/wire'

/**
 * Subscription kinds. One per resource flavor the client can observe.
 * Adding a kind here requires also defining its snapshot fetcher on the
 * server-side glue in @wanda/gateway.
 */
export const SUBSCRIPTION_KINDS = [
  'workspace-list',
  'pod-list',
  'pod-details',
  'terminal-stream',
  /**
   * Per-session agent event stream. `scope = sessionId`. Clients subscribe
   * when they attach to a session; fan-out carries `AgentEventEnvelope`
   * payloads on `event:agentSession:event`.
   */
  'agent-session',
  'git-status',
  // Legacy broadcast firehose: every connection auto-subscribes to
  // ('broadcast', 'global') on hello-ack so existing callers can keep
  // using the fan-out-to-everyone pattern while the per-resource
  // subscription model is progressively wired up.
  'broadcast',
] as const

export type SubscriptionKind = (typeof SUBSCRIPTION_KINDS)[number]

export function isSubscriptionKind(v: unknown): v is SubscriptionKind {
  return typeof v === 'string' && (SUBSCRIPTION_KINDS as readonly string[]).includes(v)
}

export interface Subscription {
  readonly id: string
  readonly clientId: string
  readonly sessionId: string
  readonly connectionId: string
  readonly kind: SubscriptionKind
  readonly scope: string
  readonly requestId: string
  readonly createdAt: number
}

/**
 * Abstract handle to a client connection. The real gateway plugs in a
 * WebSocket adapter; tests plug in a spy. The manager itself never touches
 * the transport directly — this keeps fan-out testable and socket-free.
 */
export interface Connection {
  readonly connectionId: string
  readonly clientId: string
  readonly sessionId: string
  /** Bytes queued in the underlying WebSocket send buffer. */
  bufferedAmount(): number
  /** Deliver a JSON envelope to the client. */
  send(envelope: Envelope): void
  /** Deliver a raw binary frame (terminal opcode frames). */
  sendBinary(bytes: Uint8Array): void
}

export interface ConnectionRegistration {
  readonly connection: Connection
  readonly registeredAt: number
}

export interface PublishResult {
  readonly delivered: number
  readonly dropped: number
}

export interface SubscriptionManagerConfig {
  /** Defaults to Date.now. */
  readonly now?: () => number
  /** UUID generator for subscription ids. Defaults to random-bytes-hex. */
  readonly newId?: () => string
  /**
   * Bytes buffered in a WS's send queue above which non-terminal events are
   * dropped (spec §4.4 backpressure = 256 KB).
   */
  readonly backpressureThresholdBytes?: number
}
