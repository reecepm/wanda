// -----------------------------------------------------------------------------
// SubscriptionManager — in-memory registry + typed event routing.
//
// Responsibilities:
//   - Keep track of which client connections care about which (kind, scope).
//   - Dedup subscribe requests inside a connection so React-effect double-fires
//     are idempotent.
//   - Fan events out to matching subscribers only (O(subscribers-for-scope)).
//   - Enforce per-connection backpressure on non-terminal envelopes; terminal
//     binary frames are always-send (see spec §4.4).
//   - Tear down all subscriptions when a connection drops.
//
// This module is pure logic + a few maps. The WebSocket glue lives in
// @wanda/gateway, which presents each WS as a Connection and feeds events
// from @wanda/event-log.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
import type { Envelope } from '@wanda/wire'
import type { Connection, PublishResult, Subscription, SubscriptionKind, SubscriptionManagerConfig } from './types.ts'
import { isSubscriptionKind } from './types.ts'

const DEFAULT_BACKPRESSURE_THRESHOLD = 256 * 1024

export class SubscriptionManager {
  private readonly now: () => number
  private readonly newId: () => string
  private readonly backpressureThreshold: number

  private readonly connections = new Map<string, Connection>()
  private readonly subsById = new Map<string, Subscription>()
  private readonly subsByResource = new Map<string, Set<string>>() // `${kind}:${scope}` → ids
  private readonly subsByConnection = new Map<string, Set<string>>() // connectionId → ids
  // Dedup key: `${connectionId}\x00${kind}\x00${scope}\x00${requestId}` → subscriptionId.
  // Null-byte separators because requestId is client-supplied — no encoding needed.
  private readonly subsByDedupKey = new Map<string, string>()

  // Metrics the gateway can read for telemetry.
  private _droppedEvents = 0

  constructor(config: SubscriptionManagerConfig = {}) {
    this.now = config.now ?? Date.now
    this.newId = config.newId ?? defaultNewId
    this.backpressureThreshold = config.backpressureThresholdBytes ?? DEFAULT_BACKPRESSURE_THRESHOLD
  }

  // --- Connection lifecycle -------------------------------------------------

  registerConnection(connection: Connection): void {
    if (this.connections.has(connection.connectionId)) {
      throw new Error(`connection already registered: ${connection.connectionId}`)
    }
    this.connections.set(connection.connectionId, connection)
    this.subsByConnection.set(connection.connectionId, new Set())
  }

  /**
   * Drop a connection and every subscription tied to it. Returns the number
   * of subscriptions removed so the gateway can log telemetry.
   */
  unregisterConnection(connectionId: string): number {
    const ids = this.subsByConnection.get(connectionId)
    const count = ids ? ids.size : 0
    if (ids) {
      for (const id of [...ids]) this.removeSubscription(id)
    }
    this.subsByConnection.delete(connectionId)
    this.connections.delete(connectionId)
    return count
  }

  // --- Subscribe / unsubscribe ---------------------------------------------

  /**
   * Create (or return the existing dedup'd) subscription for this connection.
   * Dedup is scoped to (connectionId, kind, scope, requestId): a React effect
   * that fires twice with the same requestId gets the same subscription back.
   */
  subscribe(opts: { connectionId: string; kind: SubscriptionKind; scope: string; requestId: string }): Subscription {
    if (!isSubscriptionKind(opts.kind)) {
      throw new Error(`unknown subscription kind: ${opts.kind}`)
    }
    if (typeof opts.scope !== 'string' || opts.scope.length === 0) {
      throw new Error('subscribe: scope must be a non-empty string')
    }
    if (typeof opts.requestId !== 'string' || opts.requestId.length === 0) {
      throw new Error('subscribe: requestId must be a non-empty string')
    }
    const conn = this.connections.get(opts.connectionId)
    if (!conn) throw new Error(`subscribe: unknown connection ${opts.connectionId}`)

    const dedupKey = this.makeDedupKey(opts.connectionId, opts.kind, opts.scope, opts.requestId)
    const existing = this.subsByDedupKey.get(dedupKey)
    if (existing) {
      const sub = this.subsById.get(existing)
      // Invariant: dedup index stays coherent with subsById — if not, wipe
      // and treat as missing.
      if (sub) return sub
      this.subsByDedupKey.delete(dedupKey)
    }

    const id = this.newId()
    const sub: Subscription = {
      id,
      clientId: conn.clientId,
      sessionId: conn.sessionId,
      connectionId: conn.connectionId,
      kind: opts.kind,
      scope: opts.scope,
      requestId: opts.requestId,
      createdAt: this.now(),
    }

    this.subsById.set(id, sub)
    this.subsByDedupKey.set(dedupKey, id)

    const resKey = this.makeResourceKey(opts.kind, opts.scope)
    let resSet = this.subsByResource.get(resKey)
    if (!resSet) {
      resSet = new Set()
      this.subsByResource.set(resKey, resSet)
    }
    resSet.add(id)

    this.subsByConnection.get(conn.connectionId)!.add(id)

    return sub
  }

  /**
   * Remove a subscription by id. Returns true if it existed.
   */
  unsubscribe(subscriptionId: string): boolean {
    const sub = this.subsById.get(subscriptionId)
    if (!sub) return false
    this.removeSubscription(subscriptionId)
    return true
  }

  get(subscriptionId: string): Subscription | null {
    return this.subsById.get(subscriptionId) ?? null
  }

  // --- Routing --------------------------------------------------------------

  /**
   * Deliver a JSON envelope to every subscription matching (kind, scope).
   * Respects backpressure: if a target connection's send buffer is too deep,
   * the envelope is dropped for that connection and counted in `dropped`.
   */
  publishEvent(kind: SubscriptionKind, scope: string, envelope: Envelope): PublishResult {
    const resKey = this.makeResourceKey(kind, scope)
    const ids = this.subsByResource.get(resKey)
    if (!ids || ids.size === 0) return { delivered: 0, dropped: 0 }

    let delivered = 0
    let dropped = 0
    for (const id of ids) {
      const sub = this.subsById.get(id)
      if (!sub) continue
      const conn = this.connections.get(sub.connectionId)
      if (!conn) continue

      if (conn.bufferedAmount() > this.backpressureThreshold) {
        dropped++
        this._droppedEvents++
        continue
      }
      try {
        conn.send(envelope)
        delivered++
      } catch {
        // A send throw means the transport has already failed. Don't halt the
        // whole fan-out; the gateway's close listener will unregister the
        // connection shortly.
        dropped++
        this._droppedEvents++
      }
    }

    return { delivered, dropped }
  }

  /**
   * Deliver a binary frame (terminal PTY data) to every terminal-stream
   * subscription matching `scope` (ptyInstanceId). Binary frames are
   * always-send — no backpressure drop per spec §4.4. If a connection's
   * buffer is pathological the gateway is responsible for closing it.
   */
  publishBinary(scope: string, frame: Uint8Array): number {
    const resKey = this.makeResourceKey('terminal-stream', scope)
    const ids = this.subsByResource.get(resKey)
    if (!ids || ids.size === 0) return 0
    let delivered = 0
    for (const id of ids) {
      const sub = this.subsById.get(id)
      if (!sub) continue
      const conn = this.connections.get(sub.connectionId)
      if (!conn) continue
      try {
        conn.sendBinary(frame)
        delivered++
      } catch {
        /* see publishEvent rationale */
      }
    }
    return delivered
  }

  // --- Inspection -----------------------------------------------------------

  listByConnection(connectionId: string): Subscription[] {
    const ids = this.subsByConnection.get(connectionId)
    if (!ids) return []
    return [...ids].map((id) => this.subsById.get(id)!).filter(Boolean)
  }

  listByResource(kind: SubscriptionKind, scope: string): Subscription[] {
    const ids = this.subsByResource.get(this.makeResourceKey(kind, scope))
    if (!ids) return []
    return [...ids].map((id) => this.subsById.get(id)!).filter(Boolean)
  }

  getById(id: string): Subscription | null {
    return this.subsById.get(id) ?? null
  }

  count(): number {
    return this.subsById.size
  }

  connectionCount(): number {
    return this.connections.size
  }

  droppedEvents(): number {
    return this._droppedEvents
  }

  // --- Internals ------------------------------------------------------------

  private makeResourceKey(kind: SubscriptionKind, scope: string): string {
    return `${kind}:${scope}`
  }

  private makeDedupKey(connectionId: string, kind: SubscriptionKind, scope: string, requestId: string): string {
    return `${connectionId}\x00${kind}\x00${scope}\x00${requestId}`
  }

  private removeSubscription(id: string): void {
    const sub = this.subsById.get(id)
    if (!sub) return
    this.subsById.delete(id)

    const resKey = this.makeResourceKey(sub.kind, sub.scope)
    const resSet = this.subsByResource.get(resKey)
    if (resSet) {
      resSet.delete(id)
      if (resSet.size === 0) this.subsByResource.delete(resKey)
    }

    const connSet = this.subsByConnection.get(sub.connectionId)
    if (connSet) connSet.delete(id)

    const dedupKey = this.makeDedupKey(sub.connectionId, sub.kind, sub.scope, sub.requestId)
    if (this.subsByDedupKey.get(dedupKey) === id) {
      this.subsByDedupKey.delete(dedupKey)
    }
  }
}

function defaultNewId(): string {
  return randomBytes(16).toString('hex')
}
