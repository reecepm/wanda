// -----------------------------------------------------------------------------
// WsConnection — adapts a live `ws` WebSocket to the @wanda/subscriptions
// `Connection` interface.
//
// Single-responsibility: bridge envelopes + binary frames onto the socket,
// track the socket's send buffer, and clean up when the socket closes. The
// gateway owns the higher-level protocol loop (hello, replay, subscribe).
// -----------------------------------------------------------------------------

import type { Connection } from '@wanda/subscriptions'
import type { Envelope } from '@wanda/wire'
import { encodeEnvelope } from '@wanda/wire'
import type { WebSocket } from 'ws'

export class WsConnection implements Connection {
  readonly connectionId: string
  readonly clientId: string
  readonly sessionId: string
  private readonly ws: WebSocket

  constructor(opts: {
    connectionId: string
    clientId: string
    sessionId: string
    ws: WebSocket
  }) {
    this.connectionId = opts.connectionId
    this.clientId = opts.clientId
    this.sessionId = opts.sessionId
    this.ws = opts.ws
  }

  bufferedAmount(): number {
    return this.ws.bufferedAmount
  }

  send(envelope: Envelope): void {
    if (this.ws.readyState !== 1 /* OPEN */) return
    this.ws.send(encodeEnvelope(envelope))
  }

  sendBinary(bytes: Uint8Array): void {
    if (this.ws.readyState !== 1 /* OPEN */) return
    // ws `send` accepts Buffer/ArrayBuffer/TypedArray.
    this.ws.send(bytes, { binary: true })
  }

  close(code?: number, reason?: string): void {
    try {
      this.ws.close(code, reason)
    } catch {
      /* already closing */
    }
  }
}
