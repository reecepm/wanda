// -----------------------------------------------------------------------------
// WsGateway — adapter over @wanda/gateway + @wanda/subscriptions.
//
// `Gateway` owns the real WS upgrade, hello handshake, replay, subscribe, and
// keepalive logic. This adapter preserves the `WsGateway` call surface (ctor
// + broadcast + attachTo + clientCount + close) so the shell, subprocess
// entry, and legacy tests don't change. `broadcast(channel, ...args)` fans
// out via the firehose subscription every connection auto-subscribes to on
// hello-ack.
//
// Replay semantics: @wanda/gateway replays only events written to
// @wanda/event-log. Today that's `event:pod|workspace|podItem:*`; other
// broadcast channels (`orpc:invalidate`, `git:status`, `terminal:*`, ...)
// are delivered live only, never replayed across reconnect.
//
// Host allow-list: WS upgrades carry a `Host` header. When an allow-list is
// configured, a guard prepended to the HTTP server's `upgrade` event rejects
// any upgrade whose Host isn't on the list — defense-in-depth against DNS
// rebinding for loopback deployments.
// -----------------------------------------------------------------------------

import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import type { EventLog } from '@wanda/event-log'
import { Gateway } from '@wanda/gateway'
import { SubscriptionManager } from '@wanda/subscriptions'
import { type Envelope, makeEnvelope } from '@wanda/wire'
import { log } from '../packages/logger'
import type { AuthStore } from './auth'

export type WsMessageHandler = (channel: string, args: unknown[]) => void

export interface WsGatewayOpts {
  /** Auth backend — supplies the SessionStore the Gateway talks to. */
  readonly authStore: AuthStore
  /** Server identity echoed back in hello-ack. Unused here directly; kept for API stability. */
  readonly serverId: string
  /** Boot epoch. Unused here directly; consumed via the EventLog at attachTo time. */
  readonly epoch: number
  /**
   * Legacy channel router — invoked for any inbound envelope whose channel
   * isn't a built-in sys:* control message. Existing wiring uses it to
   * route `terminal:write`, `terminal:resize`, and `terminal:ack` to the
   * target manager. Future consumers should prefer per-resource
   * subscriptions instead of a firehose handler.
   */
  readonly onMessage?: WsMessageHandler
  /**
   * Host allow-list for WS upgrades. When non-empty, upgrades whose `Host`
   * header isn't on the list are rejected (enforced via the upgrade guard
   * installed in `attachTo`). Can also be set after construction via
   * `setAllowedHosts`.
   */
  readonly allowedHosts?: ReadonlyArray<string>
  /** @deprecated Path override. @wanda/gateway binds to /events by default; custom paths are not yet exposed. */
  readonly path?: string
}

export type WsEnvelope = Envelope

export class WsGateway {
  private readonly opts: WsGatewayOpts
  private readonly subscriptions: SubscriptionManager
  private gateway: Gateway | null = null
  private httpServer: HttpServer | null = null
  /**
   * Lowercased Host values permitted on WS upgrade. Empty means "no
   * enforcement" (any Host accepted) — the loopback-only bind already covers
   * the primary threat, and not every deployment supplies a list.
   */
  private allowedHosts: ReadonlySet<string> = new Set()
  /**
   * Monotonic counter for broadcast envelope seqs. Clients use
   * `seq` to address replays (`sys:replay-from`); broadcasts that aren't
   * event-log backed still need strictly-increasing seqs so reconnecting
   * clients can reason about "saw envelope N, want > N". Incremented once
   * per broadcast call; starts at 1 so `seq === 0` remains the unset
   * sentinel elsewhere in the wire protocol.
   */
  private broadcastSeq = 0

  constructor(opts: WsGatewayOpts) {
    this.opts = opts
    this.subscriptions = new SubscriptionManager()
    if (opts.allowedHosts) this.setAllowedHosts(opts.allowedHosts)
  }

  /**
   * Broadcast a JSON envelope to every ready client. Implementation publishes
   * via the firehose subscription that every connection auto-installs on
   * hello-ack. The adapter intentionally keeps this shape so legacy callers
   * (`wsGateway.broadcast('pod:status', podId, ...)`) work unchanged.
   *
   * Seq selection: `event:*` broadcasts are dual-published from the durable
   * EventLog and the event-log record seq is passed through in the first
   * arg (`{ seq: record.seq, ... }`). Reuse that so live envelopes and
   * replay envelopes share a seq space — clients can address reconnect
   * replays by "last seq I saw" without drift. All other channels (ephemeral
   * firehose events like `orpc:invalidate`, `pod:status`, ...) fall back
   * to a per-gateway monotonic counter so consumers at least see a strictly
   * increasing stream.
   */
  readonly broadcast = (channel: string, ...args: unknown[]): void => {
    let seq: number | undefined
    if (channel.startsWith('event:')) {
      const head = args[0]
      if (head && typeof head === 'object' && 'seq' in head && typeof (head as { seq?: unknown }).seq === 'number') {
        seq = (head as { seq: number }).seq
      }
    }
    if (seq === undefined) {
      this.broadcastSeq += 1
      seq = this.broadcastSeq
    }
    this.subscriptions.publishEvent('broadcast', 'global', makeEnvelope(channel, args, { seq }))
  }

  /**
   * Attach the WS gateway to an already-bound HTTP server. Takes the runtime's
   * EventLog so sys:replay-from requests are served from durable storage
   * rather than an in-memory ring buffer.
   */
  attachTo(httpServer: HttpServer, eventLog: EventLog): void {
    if (this.gateway) return
    this.httpServer = httpServer
    // Prepend so the Host guard runs before @wanda/gateway's own upgrade
    // listener: a rejected upgrade destroys the socket here, and the
    // gateway's later handler then writes to a dead socket (no-op).
    httpServer.prependListener('upgrade', this.guardUpgradeHost)
    this.gateway = new Gateway({
      httpServer,
      sessionStore: this.opts.authStore.sessions,
      eventLog,
      subscriptions: this.subscriptions,
      wsPath: this.opts.path,
      onConnectionReady: (connectionId) => {
        // Firehose: every new connection gets auto-subscribed to ('broadcast',
        // 'global') so `wsGateway.broadcast()` callers keep working without
        // migrating to per-resource subscriptions.
        this.subscriptions.subscribe({
          connectionId,
          kind: 'broadcast',
          scope: 'global',
          requestId: `firehose-${connectionId}`,
        })
      },
      onInboundMessage: (_connectionId, env) => {
        if (!this.opts.onMessage) return false
        if (env.channel.startsWith('sys:') || env.channel.startsWith('event:')) return false
        this.opts.onMessage(env.channel, [...env.args])
        return true
      },
    })
    this.gateway.start()
  }

  setAllowedHosts(hosts: ReadonlyArray<string> | undefined): void {
    this.allowedHosts = new Set((hosts ?? []).map((h) => h.toLowerCase()))
  }

  /**
   * Reject WS upgrades whose `Host` header isn't on the allow-list. Runs
   * before @wanda/gateway's upgrade handler (see `attachTo`). A missing or
   * disallowed Host is destroyed with a 403 before any wsToken is consumed.
   * No-op when the allow-list is empty.
   */
  private readonly guardUpgradeHost = (req: IncomingMessage, socket: Socket): void => {
    if (this.allowedHosts.size === 0) return
    const host = req.headers.host?.toLowerCase()
    if (host && this.allowedHosts.has(host)) return
    log.main.warn(`ws-gateway: rejected WS upgrade from disallowed Host ${req.headers.host ?? '<none>'}`)
    try {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    } catch {
      /* socket may already be torn down */
    }
    socket.destroy()
  }

  get clientCount(): number {
    return this.gateway?.openConnections() ?? 0
  }

  /**
   * Expose the SubscriptionManager so server-side services (notably the
   * agent runtime's event fanout) can publish per-resource events that
   * reach only the right subscribers, bypassing the legacy broadcast
   * firehose.
   */
  get subscriptionManager(): SubscriptionManager {
    return this.subscriptions
  }

  async close(): Promise<void> {
    const gw = this.gateway
    this.gateway = null
    this.httpServer?.removeListener('upgrade', this.guardUpgradeHost)
    this.httpServer = null
    if (gw) await gw.stop()
  }
}
