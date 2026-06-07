// -----------------------------------------------------------------------------
// Gateway — composes session, event-log, subscriptions onto a live WebSocket.
//
// Per spec §4.5, this module:
//   - Accepts WS upgrades at a configured path (default /events)
//   - Consumes a one-shot wsToken to bind the socket to a session
//   - Runs the hello / hello-ack / hello-rejected handshake
//   - Handles sys:replay-from by streaming EventLog pages
//   - Handles sys:subscribe / sys:unsubscribe via SubscriptionManager
//   - Runs the keepalive ping/pong loop (server pings every 15 s; drop after 45 s silence)
//   - Tears subscriptions down on WS close (connection-scoped cleanup)
//
// RPC / emits middleware wiring is a separate concern (Phase 6+). This module
// consumes an EventLog as a source of truth but does not own mutation logic.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import { URL } from 'node:url'
import type { EventLog, EventRecord } from '@wanda/event-log'
import type { Session } from '@wanda/session'
import { type WebSocket, WebSocketServer } from 'ws'

/**
 * Minimal interface the gateway needs from its session backend. @wanda/session's
 * SessionStore naturally implements this, but callers can also supply any
 * adapter (e.g. over an existing AuthStore) that exposes these methods.
 */
export interface GatewaySessionBackend {
  consumeWsToken(
    token: string,
  ):
    | { readonly ok: true; readonly sessionId: string; readonly clientId: string }
    | { readonly ok: false; readonly reason: 'not-found' | 'expired' | 'already-consumed' }
  findById(sessionId: string): Session | null
  identity(): { readonly id: string; readonly epoch: number; readonly createdAt: number }
  clearGrace(clientId: string): void
  markDisconnected(sessionId: string): void
}

import { isSubscriptionKind, type SubscriptionKind, type SubscriptionManager } from '@wanda/subscriptions'
import {
  decodeEnvelope,
  type Envelope,
  encodeEnvelope,
  HELLO_ACK_CHANNEL,
  HELLO_CHANNEL,
  HELLO_REJECTED_CHANNEL,
  HelloSchema,
  isResourceKind,
  makeEnvelope,
  PROTOCOL_VERSION,
  type ResourceKind,
} from '@wanda/wire'
import { WsConnection } from './ws-connection.ts'

const DEFAULT_PING_INTERVAL_MS = 15_000
const DEFAULT_PING_TIMEOUT_MS = 45_000
const DEFAULT_REPLAY_PAGE_SIZE = 1000
const DEFAULT_WS_PATH = '/events'

export interface GatewayOptions {
  readonly httpServer: HttpServer
  readonly sessionStore: GatewaySessionBackend
  readonly eventLog: EventLog
  readonly subscriptions: SubscriptionManager
  readonly wsPath?: string
  readonly pingIntervalMs?: number
  readonly pingTimeoutMs?: number
  /** Test hook — override for deterministic connection ids. */
  readonly newConnectionId?: () => string
  /** Default 1000. */
  readonly replayPageSize?: number
  /** Test hook — fire after the server processes each inbound envelope. */
  readonly onMessageHandled?: (connectionId: string, channel: string) => void
  /** Test hook — clock override. */
  readonly now?: () => number
  /**
   * Fires synchronously right after a successful hello-ack has been sent.
   * Lets callers auto-subscribe the new connection to any default scopes
   * they want (e.g. a broadcast "firehose" for backward-compat with legacy
   * broadcast-to-everyone semantics).
   */
  readonly onConnectionReady?: (connectionId: string, session: { sessionId: string; clientId: string }) => void
  readonly logger?: (message: string, ctx?: unknown) => void
  /**
   * Synchronously handle an inbound envelope that's not one of the built-in
   * sys:* or event:* messages. Returning `true` signals the gateway to
   * treat the message as handled; returning anything else (including
   * undefined) falls through to the default ignore-unknown behaviour.
   * Useful for legacy channels that still flow through the gateway while
   * a full per-subscription migration is in progress (e.g. terminal:write).
   */
  readonly onInboundMessage?: (
    connectionId: string,
    envelope: { channel: string; args: readonly unknown[] },
  ) => boolean | void
}

type HandledState = 'pending-hello' | 'ready' | 'closing'

interface ConnectionContext {
  state: HandledState
  ws: WebSocket
  conn: WsConnection | null
  lastInboundAt: number
  pingTimer: NodeJS.Timeout | null
}

/**
 * Wire up WS upgrades + the full control-plane protocol against an HTTP server.
 * The `start()` call attaches the WS server; `stop()` closes every socket and
 * detaches. Multiple Gateway instances on the same HTTP server are NOT
 * supported — the ws library binds to `upgrade`.
 */
export class Gateway {
  private readonly wss: WebSocketServer
  private readonly wsPath: string
  private readonly pingIntervalMs: number
  private readonly pingTimeoutMs: number
  private readonly replayPageSize: number
  private readonly newConnectionId: () => string
  private readonly now: () => number
  private readonly onMessageHandled: ((connectionId: string, channel: string) => void) | null
  private readonly logger: (message: string, ctx?: unknown) => void

  private readonly ctxByConn = new Map<string, ConnectionContext>()
  private started = false
  private readonly opts: GatewayOptions

  constructor(opts: GatewayOptions) {
    this.opts = opts
    this.wsPath = opts.wsPath ?? DEFAULT_WS_PATH
    this.pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS
    this.pingTimeoutMs = opts.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS
    this.replayPageSize = opts.replayPageSize ?? DEFAULT_REPLAY_PAGE_SIZE
    this.newConnectionId = opts.newConnectionId ?? (() => randomBytes(12).toString('hex'))
    this.now = opts.now ?? Date.now
    this.onMessageHandled = opts.onMessageHandled ?? null
    this.logger = opts.logger ?? (() => {})
    this.wss = new WebSocketServer({ noServer: true })
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.opts.httpServer.on('upgrade', this.handleUpgrade)
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    this.opts.httpServer.off('upgrade', this.handleUpgrade)
    for (const ctx of this.ctxByConn.values()) {
      if (ctx.pingTimer) clearInterval(ctx.pingTimer)
      try {
        ctx.ws.close(1001, 'gateway shutdown')
      } catch {
        /* ignore */
      }
    }
    this.ctxByConn.clear()
    await new Promise<void>((resolve) => this.wss.close(() => resolve()))
  }

  // Arrow so we can `.off` the same reference we registered.
  private handleUpgrade = (req: IncomingMessage, socket: NodeJS.WritableStream, head: Buffer): void => {
    const url = this.parseUrl(req)
    if (!url || url.pathname !== this.wsPath) return

    const wsToken = url.searchParams.get('wsToken')
    if (!wsToken) return this.rejectUpgrade(socket, 401)

    const result = this.opts.sessionStore.consumeWsToken(wsToken)
    if (!result.ok) return this.rejectUpgrade(socket, 401)

    this.wss.handleUpgrade(
      req,
      socket as unknown as NonNullable<Parameters<typeof this.wss.handleUpgrade>[1]>,
      head,
      (ws) => {
        this.attachSocket(ws, result.sessionId, result.clientId)
      },
    )
  }

  private parseUrl(req: IncomingMessage): URL | null {
    try {
      // IncomingMessage.url is path+query only; need a base.
      return new URL(req.url ?? '/', 'http://localhost')
    } catch {
      return null
    }
  }

  private rejectUpgrade(socket: NodeJS.WritableStream, status: 401 | 403): void {
    const reason = status === 401 ? 'Unauthorized' : 'Forbidden'
    try {
      ;(socket as unknown as { write: (data: string) => void }).write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`)
    } catch {
      /* ignore */
    }
    try {
      ;(socket as unknown as { destroy: () => void }).destroy()
    } catch {
      /* ignore */
    }
  }

  // --- Per-socket protocol loop --------------------------------------------

  private attachSocket(ws: WebSocket, sessionId: string, _clientId: string): void {
    const connectionId = this.newConnectionId()
    const ctx: ConnectionContext = {
      state: 'pending-hello',
      ws,
      conn: null,
      lastInboundAt: this.now(),
      pingTimer: null,
    }
    this.ctxByConn.set(connectionId, ctx)

    // One ping interval per socket. Drops the socket if lastInboundAt is older
    // than pingTimeoutMs — the spec says 45 s.
    const pingTimer = setInterval(() => {
      if (ctx.state === 'closing') return
      if (this.now() - ctx.lastInboundAt > this.pingTimeoutMs) {
        this.closeConnection(connectionId, 1001, 'idle-timeout')
        return
      }
      try {
        ws.send(encodeSysPing())
      } catch {
        /* ignore — close listener will clean up */
      }
    }, this.pingIntervalMs)
    // Node interval unref so test teardown isn't blocked.
    pingTimer.unref?.()
    ctx.pingTimer = pingTimer

    ws.on('message', (raw) => {
      ctx.lastInboundAt = this.now()
      if (typeof raw !== 'string' && !(raw instanceof Buffer)) return
      const text = typeof raw === 'string' ? raw : raw.toString('utf8')
      this.handleMessage(connectionId, sessionId, text).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[gateway] handleMessage threw', err)
        this.closeConnection(connectionId, 1011, 'server-error')
      })
    })

    ws.on('close', () => {
      this.teardownConnection(connectionId)
    })

    ws.on('error', () => {
      this.teardownConnection(connectionId)
    })
  }

  private async handleMessage(connectionId: string, sessionId: string, text: string): Promise<void> {
    const decoded = decodeEnvelope(text)
    if (!decoded.ok) {
      this.closeConnection(connectionId, 1003, `decode-error:${decoded.error.type}`)
      return
    }
    const env = decoded.envelope
    const ctx = this.ctxByConn.get(connectionId)
    if (!ctx) return

    switch (env.channel) {
      case HELLO_CHANNEL:
        await this.onHello(connectionId, sessionId, env)
        break
      case 'sys:ping':
        // Peer-originated keepalive — respond.
        this.sendCtx(ctx, makeEnvelope('sys:pong', [], { ts: this.now() }))
        break
      case 'sys:pong':
        // Our own ping got answered; lastInboundAt already touched.
        break
      case 'sys:replay-from':
        await this.onReplayFrom(connectionId, env)
        break
      case 'sys:replay-from-scoped':
        await this.onReplayFromScoped(connectionId, env)
        break
      case 'sys:subscribe':
        this.onSubscribe(connectionId, env)
        break
      case 'sys:unsubscribe':
        this.onUnsubscribe(connectionId, env)
        break
      default: {
        // Unknown channel — give the wrapper a chance to handle legacy
        // inbound messages (e.g. terminal:write). If it doesn't claim the
        // envelope, we silently drop per forward-compat policy.
        const handled = this.opts.onInboundMessage?.(connectionId, {
          channel: env.channel,
          args: env.args,
        })
        if (handled !== true) {
          // swallow unknown envelope
        }
        break
      }
    }

    this.onMessageHandled?.(connectionId, env.channel)
  }

  private async onHello(connectionId: string, sessionId: string, env: Envelope): Promise<void> {
    const ctx = this.ctxByConn.get(connectionId)
    if (!ctx) return
    if (ctx.state !== 'pending-hello') {
      this.closeConnection(connectionId, 1002, 'hello-after-ready')
      return
    }

    const payload = env.args[0]
    const parsed = HelloSchema.safeParse(payload)
    if (!parsed.success) {
      this.sendCtx(
        ctx,
        makeEnvelope(HELLO_REJECTED_CHANNEL, [{ reason: 'unsupported-version' }], {
          ts: this.now(),
        }),
      )
      this.closeConnection(connectionId, 1002, 'bad-hello')
      return
    }

    const session = this.opts.sessionStore.findById(sessionId)
    if (!session) {
      this.sendCtx(ctx, makeEnvelope(HELLO_REJECTED_CHANNEL, [{ reason: 'invalid-session' }], { ts: this.now() }))
      this.closeConnection(connectionId, 1008, 'invalid-session')
      return
    }

    const identity = this.opts.sessionStore.identity()
    const ack = {
      serverId: identity.id,
      serverSeq: this.opts.eventLog.currentSeq(),
      epoch: identity.epoch,
      protocolSupported: [PROTOCOL_VERSION],
    }

    ctx.conn = new WsConnection({
      connectionId,
      clientId: session.clientId,
      sessionId: session.sessionId,
      ws: ctx.ws,
    })
    this.opts.subscriptions.registerConnection(ctx.conn)
    ctx.state = 'ready'
    this.opts.sessionStore.clearGrace(session.clientId)
    this.logger('gateway.hello:ready', {
      connectionId,
      sessionId: session.sessionId,
      serverSeq: ack.serverSeq,
      epoch: ack.epoch,
    })

    this.sendCtx(ctx, makeEnvelope(HELLO_ACK_CHANNEL, [ack], { ts: this.now() }))

    // Inform the wrapper that the connection is ready so it can install any
    // default subscriptions (e.g. firehose) or cache per-connection state.
    try {
      this.opts.onConnectionReady?.(connectionId, {
        sessionId: session.sessionId,
        clientId: session.clientId,
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[gateway] onConnectionReady hook threw', err)
    }
  }

  private async onReplayFrom(connectionId: string, env: Envelope): Promise<void> {
    const ctx = this.ctxByConn.get(connectionId)
    if (!ctx || ctx.state !== 'ready') return
    const body = env.args[0] as { sinceSeq?: number; sinceEpoch?: number } | undefined
    if (!body || typeof body.sinceSeq !== 'number' || typeof body.sinceEpoch !== 'number') {
      this.sendCtx(ctx, makeEnvelope('sys:replay-gone', [{ reason: 'invalid-cursor' }], { ts: this.now() }))
      return
    }

    let cursor = body.sinceSeq
    while (true) {
      const page = this.opts.eventLog.replayPage(cursor, body.sinceEpoch, this.replayPageSize)
      if (!page.ok) {
        this.sendCtx(ctx, makeEnvelope('sys:replay-gone', [{ reason: page.reason }], { ts: this.now() }))
        return
      }
      for (const record of page.events) {
        this.sendCtx(ctx, envelopeForRecord(record))
      }
      if (page.done) break
      cursor = page.nextCursor
    }
    this.sendCtx(
      ctx,
      makeEnvelope('sys:replay-complete', [{ serverSeq: this.opts.eventLog.currentSeq() }], { ts: this.now() }),
    )
  }

  /**
   * Per-resource backfill. Used by consumers (e.g. the agent renderer) that
   * attached mid-log and want to page only their own resource's events
   * rather than a global replay. Payload:
   *   { sinceSeq, sinceEpoch, scope: { kind, id }, upToSeq? }
   * Streams one envelope per record, then `sys:replay-complete`. Returns
   * `sys:replay-gone` on epoch-mismatch / too-old / invalid-args.
   */
  private async onReplayFromScoped(connectionId: string, env: Envelope): Promise<void> {
    const ctx = this.ctxByConn.get(connectionId)
    if (!ctx || ctx.state !== 'ready') return
    const body = env.args[0] as
      | {
          sinceSeq?: number
          sinceEpoch?: number
          scope?: { kind?: unknown; id?: unknown }
          upToSeq?: number
          requestId?: unknown
        }
      | undefined
    if (
      !body ||
      typeof body.sinceSeq !== 'number' ||
      typeof body.sinceEpoch !== 'number' ||
      !body.scope ||
      !isResourceKind(body.scope.kind) ||
      typeof body.scope.id !== 'string' ||
      body.scope.id.length === 0
    ) {
      this.sendCtx(ctx, makeEnvelope('sys:replay-gone', [{ reason: 'invalid-cursor' }], { ts: this.now() }))
      return
    }
    if (body.upToSeq != null && (typeof body.upToSeq !== 'number' || body.upToSeq < 0)) {
      this.sendCtx(ctx, makeEnvelope('sys:replay-gone', [{ reason: 'invalid-cursor' }], { ts: this.now() }))
      return
    }

    const scopeKind: ResourceKind = body.scope.kind
    const scopeId: string = body.scope.id
    const requestId = typeof body.requestId === 'string' ? body.requestId : undefined
    let cursor = body.sinceSeq
    let emitted = 0
    this.logger('gateway.replay-scoped:start', {
      connectionId,
      scopeKind,
      scopeId,
      sinceSeq: body.sinceSeq,
      sinceEpoch: body.sinceEpoch,
      upToSeq: body.upToSeq ?? null,
    })
    while (true) {
      const page =
        body.sinceSeq === 0 && body.upToSeq == null
          ? this.opts.eventLog.replayPageByResourceAllEpochs(scopeKind, scopeId, {
              sinceSeq: cursor,
              limit: this.replayPageSize,
              direction: 'forward',
            })
          : this.opts.eventLog.replayPageByResource(scopeKind, scopeId, {
              sinceSeq: cursor,
              sinceEpoch: body.sinceEpoch,
              limit: this.replayPageSize,
              upToSeq: body.upToSeq,
              direction: 'forward',
            })
      if (!page.ok) {
        this.sendCtx(
          ctx,
          makeEnvelope(
            'sys:replay-gone',
            [{ reason: page.reason, scope: { kind: scopeKind, id: scopeId }, requestId }],
            { ts: this.now() },
          ),
        )
        return
      }
      for (const record of page.events) {
        emitted += 1
        this.sendCtx(ctx, envelopeForRecord(record))
      }
      if (page.done) break
      cursor = page.nextCursor
    }
    this.logger('gateway.replay-scoped:done', {
      connectionId,
      scopeKind,
      scopeId,
      emitted,
      serverSeq: this.opts.eventLog.currentSeq(),
    })
    this.sendCtx(
      ctx,
      makeEnvelope(
        'sys:replay-complete',
        [
          {
            serverSeq: this.opts.eventLog.currentSeq(),
            scope: { kind: scopeKind, id: scopeId },
            requestId,
          },
        ],
        { ts: this.now() },
      ),
    )
  }

  private onSubscribe(connectionId: string, env: Envelope): void {
    const ctx = this.ctxByConn.get(connectionId)
    if (!ctx || ctx.state !== 'ready') return
    const body = env.args[0] as { kind?: unknown; scope?: unknown; requestId?: unknown } | undefined
    if (!body) return
    const { kind, scope, requestId } = body
    if (!isSubscriptionKind(kind) || typeof scope !== 'string' || typeof requestId !== 'string') {
      this.sendCtx(
        ctx,
        makeEnvelope('sys:error', [{ in: 'sys:subscribe', reason: 'invalid-args' }], {
          ts: this.now(),
        }),
      )
      return
    }
    const sub = this.opts.subscriptions.subscribe({
      connectionId,
      kind: kind as SubscriptionKind,
      scope,
      requestId,
    })
    this.logger('gateway.subscribe', {
      connectionId,
      kind,
      scope,
      requestId,
      subscriptionId: sub.id,
    })
    this.sendCtx(
      ctx,
      makeEnvelope(
        'sys:subscribed',
        [{ subscriptionId: sub.id, snapshotSeq: this.opts.eventLog.currentSeq(), requestId }],
        { ts: this.now() },
      ),
    )
  }

  private onUnsubscribe(connectionId: string, env: Envelope): void {
    const ctx = this.ctxByConn.get(connectionId)
    if (!ctx || ctx.state !== 'ready') return
    const body = env.args[0] as { subscriptionId?: unknown } | undefined
    if (!body || typeof body.subscriptionId !== 'string') return
    const sub = this.opts.subscriptions.get(body.subscriptionId)
    if (!sub || sub.connectionId !== connectionId) return
    this.logger('gateway.unsubscribe', {
      connectionId,
      subscriptionId: body.subscriptionId,
    })
    this.opts.subscriptions.unsubscribe(body.subscriptionId)
  }

  // --- Teardown -------------------------------------------------------------

  private closeConnection(connectionId: string, code: number, reason: string): void {
    const ctx = this.ctxByConn.get(connectionId)
    if (!ctx) return
    ctx.state = 'closing'
    try {
      ctx.ws.close(code, reason)
    } catch {
      /* ignore */
    }
  }

  private teardownConnection(connectionId: string): void {
    const ctx = this.ctxByConn.get(connectionId)
    if (!ctx) return
    ctx.state = 'closing'
    if (ctx.pingTimer) clearInterval(ctx.pingTimer)
    this.opts.subscriptions.unregisterConnection(connectionId)
    if (ctx.conn) this.opts.sessionStore.markDisconnected(ctx.conn.sessionId)
    this.ctxByConn.delete(connectionId)
  }

  private sendCtx(ctx: ConnectionContext, envelope: Envelope): void {
    if (ctx.state === 'closing' || ctx.ws.readyState !== 1) return
    try {
      if (envelope.channel === 'event:agentSession:event') {
        const row = envelope.args[0] as
          | {
              resourceId?: unknown
              seq?: unknown
              payload?: { event?: { kind?: unknown } }
            }
          | undefined
        this.logger('gateway.send:event', {
          resourceId: row?.resourceId,
          seq: row?.seq,
          kind: row?.payload?.event?.kind,
        })
      }
      ctx.ws.send(encodeEnvelope(envelope))
    } catch {
      // Mark closing; onclose will finish teardown.
      ctx.state = 'closing'
    }
  }

  // --- Inspection -----------------------------------------------------------

  openConnections(): number {
    return this.ctxByConn.size
  }
}

// --- helpers -----------------------------------------------------------------

function encodeSysPing(): string {
  return encodeEnvelope({ v: PROTOCOL_VERSION, seq: 0, ts: 0, channel: 'sys:ping', args: [] })
}

function envelopeForRecord(record: EventRecord): Envelope {
  return {
    v: PROTOCOL_VERSION,
    seq: record.seq,
    ts: record.ts,
    channel: record.channel,
    args: [
      {
        resourceKind: record.resourceKind,
        resourceId: record.resourceId,
        payload: record.payload,
        epoch: record.epoch,
        seq: record.seq,
      },
    ],
  }
}
