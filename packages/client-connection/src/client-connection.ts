// ClientConnection — WS lifecycle + reconnect FSM.
//
// Owns:
//   - The WebSocket to the paired server (mint token, open, hello handshake)
//   - State transitions: idle → connecting → connected → recovering → reconnecting
//   - Recovery paths: hello-ack → replay-from → replay-complete
//                 or: hello-ack → full-resync → ready (on epoch mismatch)
//   - Exponential backoff on reconnect, reset on hello-ack
//
// Does NOT own:
//   - Any Zustand store or snapshot cache (consumer hooks do it)
//   - Subscription lifecycle (consumers re-issue subscribe on `onReady`)

import {
  decodeEnvelope,
  type Envelope,
  encodeEnvelope,
  HELLO_ACK_CHANNEL,
  HELLO_CHANNEL,
  HELLO_REJECTED_CHANNEL,
  type HelloRejectedReason,
  makeEnvelope,
  PROTOCOL_VERSION,
} from '@wanda/wire'
import { DEFAULT_BACKOFF_MS, pickBackoff } from './backoff.ts'
import type {
  ClientConnectionCallbacks,
  ConnectionState,
  MinimalWebSocket,
  ResumeCursor,
  WebSocketFactory,
} from './types.ts'

export interface ClientConnectionOptions extends ClientConnectionCallbacks {
  readonly clientId: string
  /** `getUrl()` is called on every connect so the client can re-read a
   *  healed baseUrl (e.g. after port-heal on the local server). */
  getUrl(): string | Promise<string>
  /** Mint a fresh wsToken. Called once per reconnect attempt. */
  issueWsToken(): Promise<string>
  /** Supplies lastAppliedSeq + epoch at reconnect time. Read-only — the
   *  connection never mutates the client's cursor directly. */
  getResumeCursor(): ResumeCursor
  /** Fires after each successful hello-ack so the store knows what serverSeq
   *  and epoch the server thinks we're at. */
  onHelloAck?(ack: { serverId: string; serverSeq: number; epoch: number }): void
  /** Test hook: supply a deterministic WebSocket implementation. */
  webSocketFactory?: WebSocketFactory
  readonly backoffMs?: readonly number[]
  /** Test hook: override setTimeout for deterministic backoff. */
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

const WS_OPEN = 1

export class ClientConnection {
  private readonly opts: ClientConnectionOptions
  private readonly backoffSchedule: readonly number[]
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private readonly wsFactory: WebSocketFactory

  private _state: ConnectionState = 'idle'
  private ws: MinimalWebSocket | null = null
  private reconnectAttempt = 0
  private reconnectTimer: unknown = null
  /** Envelopes the consumer wants to send; suppressed until `ready`. */
  private pendingSend: Envelope[] = []
  private disposed = false

  constructor(opts: ClientConnectionOptions) {
    this.opts = opts
    this.backoffSchedule = opts.backoffMs ?? DEFAULT_BACKOFF_MS
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as number))
    this.wsFactory = opts.webSocketFactory ?? defaultFactory
  }

  state(): ConnectionState {
    return this._state
  }

  start(): void {
    if (this._state !== 'idle') return
    void this.connect()
  }

  async stop(): Promise<void> {
    this.disposed = true
    this.transition('stopped')
    if (this.reconnectTimer != null) {
      this.clearTimer(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'client-stop')
      } catch {
        /* ignore */
      }
      this.ws = null
    }
    this.pendingSend = []
  }

  /**
   * Enqueue an envelope to be sent over the socket. While the FSM is in
   * `recovering` (post hello-ack, pre replay-complete), sends are buffered.
   * This is the mechanism spec §5.2 uses to prevent a subscribe race during
   * reconnect recovery.
   */
  send(envelope: Envelope): void {
    if (this._state === 'connected') {
      this.writeDirect(envelope)
      return
    }
    if (this._state === 'recovering' || this._state === 'connecting' || this._state === 'reconnecting') {
      this.pendingSend.push(envelope)
      return
    }
    // idle / offline / unpaired / stopped → drop. Caller owns any retry
    // semantics; the connection has no context about which send was which.
  }

  // --- FSM -----------------------------------------------------------------

  private async connect(): Promise<void> {
    if (this.disposed) return
    this.transition('connecting')
    let url: string
    let wsToken: string
    try {
      url = await this.opts.getUrl()
      wsToken = await this.opts.issueWsToken()
    } catch (err) {
      this.scheduleReconnect(err)
      return
    }

    const fullUrl = url + (url.includes('?') ? '&' : '?') + 'wsToken=' + encodeURIComponent(wsToken)
    let ws: MinimalWebSocket
    try {
      ws = this.wsFactory(fullUrl)
    } catch (err) {
      this.scheduleReconnect(err)
      return
    }
    this.ws = ws

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return
      this.sendHello()
    })
    ws.addEventListener('message', (ev) => {
      if (this.ws !== ws) return
      const text = typeof ev.data === 'string' ? ev.data : bufferToString(ev.data)
      this.handleMessage(text)
    })
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.disposed) return
      if (this._state === 'offline' || this._state === 'unpaired') return
      this.scheduleReconnect('ws-close')
    })
    ws.addEventListener('error', () => {
      // Let close handle the cleanup; chrome fires error then close.
    })
  }

  private sendHello(): void {
    const cursor = this.opts.getResumeCursor()
    const payload: Record<string, unknown> = {
      v: PROTOCOL_VERSION,
      clientId: this.opts.clientId,
    }
    if (cursor.seq > 0) payload.resumeFromSeq = cursor.seq
    if (cursor.epoch != null) payload.epoch = cursor.epoch
    this.writeDirect(makeEnvelope(HELLO_CHANNEL, [payload]))
  }

  private handleMessage(text: string): void {
    const decoded = decodeEnvelope(text)
    if (!decoded.ok) return
    const env = decoded.envelope

    switch (env.channel) {
      case HELLO_ACK_CHANNEL:
        void this.onHelloAck(env)
        return
      case HELLO_REJECTED_CHANNEL:
        this.onHelloRejected(env)
        return
      case 'sys:ping':
        this.writeDirect(makeEnvelope('sys:pong', []))
        return
      case 'sys:pong':
        return
      case 'sys:replay-complete':
        if (isScopedReplayEnvelope(env)) {
          this.opts.onReplayComplete?.(env)
          return
        }
        void this.onReplayComplete()
        return
      case 'sys:replay-gone':
        if (isScopedReplayEnvelope(env)) {
          this.opts.onReplayGone?.(env)
          return
        }
        void this.onReplayGone(env)
        return
      case 'sys:subscribed':
        this.opts.onSubscribed?.(env)
        return
      default:
        if (env.channel.startsWith('event:')) {
          this.opts.onEventEnvelope?.(env)
          return
        }
        if (env.channel.startsWith('sys:')) {
          // Unknown sys:* is ignored — forward-compat.
          return
        }
        // Grandfathered legacy namespaces fan out via the firehose.
        this.opts.onLegacyEnvelope?.(env)
    }
  }

  private async onHelloAck(env: Envelope): Promise<void> {
    const body = env.args[0] as
      | {
          serverId?: unknown
          serverSeq?: unknown
          epoch?: unknown
          protocolSupported?: unknown
        }
      | undefined
    if (
      !body ||
      typeof body.serverId !== 'string' ||
      typeof body.serverSeq !== 'number' ||
      typeof body.epoch !== 'number'
    ) {
      // Malformed ack — close and reconnect.
      this.forceReconnect('bad-hello-ack')
      return
    }

    // Successful ack resets backoff.
    this.reconnectAttempt = 0

    this.opts.onHelloAck?.({
      serverId: body.serverId,
      serverSeq: body.serverSeq,
      epoch: body.epoch,
    })

    const cursor = this.opts.getResumeCursor()
    const epochChanged = cursor.epoch != null && cursor.epoch !== body.epoch

    if (epochChanged) {
      this.transition('recovering')
      try {
        await this.opts.onFullResyncNeeded?.('epoch-changed', {
          serverId: body.serverId,
          epoch: body.epoch,
        })
      } catch {
        // A failing resync bounces us back through reconnect rather than
        // silently hanging on stale state.
        this.forceReconnect('full-resync-failed')
        return
      }
      await this.enterReady()
      return
    }

    // Same epoch (or first-ever hello): issue replay-from. Even if
    // cursor.seq is 0 this is harmless — empty page and we proceed.
    this.transition('recovering')
    this.writeDirect(makeEnvelope('sys:replay-from', [{ sinceSeq: cursor.seq, sinceEpoch: body.epoch }]))
  }

  private onHelloRejected(env: Envelope): void {
    const reason = (env.args[0] as { reason?: unknown } | undefined)?.reason as HelloRejectedReason | undefined
    if (reason) this.opts.onHelloRejected?.(reason)
    // Per spec: do not retry on hello-rejected.
    this.transition(reason === 'revoked' ? 'unpaired' : 'offline')
    if (this.ws) {
      try {
        this.ws.close(1008, reason ?? 'rejected')
      } catch {
        /* ignore */
      }
      this.ws = null
    }
    this.pendingSend = []
  }

  private async onReplayComplete(): Promise<void> {
    if (this._state !== 'recovering') return
    await this.enterReady()
  }

  private async onReplayGone(env: Envelope): Promise<void> {
    if (this._state !== 'recovering') return
    const reason = (env.args[0] as { reason?: string } | undefined)?.reason
    try {
      await this.opts.onFullResyncNeeded?.('replay-gone', {
        serverId: '',
        epoch: 0,
      })
    } catch {
      this.forceReconnect(`resync-failed:${reason ?? ''}`)
      return
    }
    await this.enterReady()
  }

  private async enterReady(): Promise<void> {
    // Flush pending outbound before transitioning to `connected`, because
    // some subscribers rely on `onReady` firing AFTER the queue has been
    // committed to the wire. Order: flush → transition → callback.
    for (const env of this.pendingSend) this.writeDirect(env)
    this.pendingSend = []
    this.transition('connected')
    try {
      await this.opts.onReady?.()
    } catch {
      /* consumer error isolated; state is already `connected`. */
    }
  }

  private scheduleReconnect(_cause: unknown): void {
    if (this.disposed) return
    if (this._state === 'offline' || this._state === 'unpaired') return
    this.reconnectAttempt++
    const delay = pickBackoff(this.backoffSchedule, this.reconnectAttempt)
    this.transition('reconnecting')
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  private forceReconnect(_cause: string): void {
    if (this.ws) {
      try {
        this.ws.close(1011, _cause)
      } catch {
        /* ignore */
      }
      this.ws = null
    }
    this.scheduleReconnect(_cause)
  }

  private transition(next: ConnectionState): void {
    if (this._state === next) return
    this._state = next
    try {
      this.opts.onStateChange?.(next)
    } catch {
      /* ignore */
    }
  }

  private writeDirect(envelope: Envelope): void {
    if (!this.ws || this.ws.readyState !== WS_OPEN) return
    try {
      this.ws.send(encodeEnvelope(envelope))
    } catch {
      // Socket died mid-send; let close event handle transition.
    }
  }
}

function isScopedReplayEnvelope(env: Envelope): boolean {
  const body = env.args[0] as { scope?: unknown; requestId?: unknown } | undefined
  return !!body && (body.scope != null || typeof body.requestId === 'string')
}

function bufferToString(data: unknown): string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data))
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data as ArrayBufferView)
  }
  return String(data)
}

function defaultFactory(url: string): MinimalWebSocket {
  const ctor = (globalThis as unknown as { WebSocket?: new (url: string) => MinimalWebSocket }).WebSocket
  if (!ctor) {
    throw new Error('ClientConnection: no global WebSocket available. Pass `webSocketFactory` explicitly in Node.')
  }
  return new ctor(url)
}
