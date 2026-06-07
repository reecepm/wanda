// -----------------------------------------------------------------------------
// Shared helpers: fake Connection implementation and ID counters.
// -----------------------------------------------------------------------------

import type { Envelope } from '@wanda/wire'
import type { Connection } from '../types.ts'

export class FakeConnection implements Connection {
  readonly connectionId: string
  readonly clientId: string
  readonly sessionId: string
  readonly sent: Envelope[] = []
  readonly binary: Uint8Array[] = []
  private _buffered = 0
  private throwOnSend = false

  constructor(init: { connectionId: string; clientId: string; sessionId: string }) {
    this.connectionId = init.connectionId
    this.clientId = init.clientId
    this.sessionId = init.sessionId
  }

  bufferedAmount(): number {
    return this._buffered
  }
  setBuffered(bytes: number): void {
    this._buffered = bytes
  }

  failNextSend(): void {
    this.throwOnSend = true
  }

  send(envelope: Envelope): void {
    if (this.throwOnSend) {
      this.throwOnSend = false
      throw new Error('simulated transport failure')
    }
    this.sent.push(envelope)
  }

  sendBinary(bytes: Uint8Array): void {
    this.binary.push(bytes)
  }
}

export function makeEnvelope(channel: string, seq = 0): Envelope {
  return { v: 1, seq, ts: 0, channel, args: [] }
}

/** Deterministic id generator for tests. */
export function sequentialIds(): () => string {
  let n = 0
  return () => `sub-${++n}`
}
