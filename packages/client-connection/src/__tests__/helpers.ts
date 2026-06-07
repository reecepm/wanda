// -----------------------------------------------------------------------------
// Hand-rolled mock WebSocket + deterministic timer for FSM tests.
// -----------------------------------------------------------------------------

import {
  decodeEnvelope,
  type Envelope,
  encodeEnvelope,
  HELLO_ACK_CHANNEL,
  HELLO_REJECTED_CHANNEL,
  makeEnvelope,
  PROTOCOL_VERSION,
} from '@wanda/wire'
import type { MinimalWebSocket } from '../types.ts'

export class MockWebSocket implements MinimalWebSocket {
  readyState = 0
  readonly url: string
  readonly sent: Envelope[] = []
  private listeners: Record<string, Array<(...args: never[]) => void>> = {}
  private closed = false

  constructor(url: string) {
    this.url = url
  }

  addEventListener(type: string, listener: (...args: never[]) => void): void {
    ;(this.listeners[type] ??= []).push(listener)
  }
  removeEventListener(type: string, listener: (...args: never[]) => void): void {
    const arr = this.listeners[type]
    if (!arr) return
    const i = arr.indexOf(listener)
    if (i >= 0) arr.splice(i, 1)
  }
  send(data: string): void {
    if (this.closed) throw new Error('send on closed socket')
    const env = decodeEnvelope(data)
    if (env.ok) this.sent.push(env.envelope)
  }
  close(code = 1000, reason = ''): void {
    if (this.closed) return
    this.closed = true
    this.readyState = 3
    this.emit('close', { code, reason })
  }

  // Test-facing simulators
  simulateOpen(): void {
    this.readyState = 1
    this.emit('open')
  }
  simulateMessage(env: Envelope): void {
    this.emit('message', { data: encodeEnvelope(env) })
  }
  simulateRawMessage(data: string): void {
    this.emit('message', { data })
  }
  simulateClose(code = 1006, reason = 'network-drop'): void {
    if (this.closed) return
    this.closed = true
    this.readyState = 3
    this.emit('close', { code, reason })
  }
  simulateError(err: unknown = new Error('simulated')): void {
    this.emit('error', err)
  }
  sentChannels(): string[] {
    return this.sent.map((e) => e.channel)
  }

  private emit(type: string, arg?: unknown): void {
    for (const l of this.listeners[type] ?? []) {
      try {
        // Listeners expect a specific arg shape per type; we pass-through.
        ;(l as (a?: unknown) => void)(arg)
      } catch (err) {
        // Test-time visibility if a listener throws.
        // eslint-disable-next-line no-console
        console.error(`MockWebSocket listener ${type} threw`, err)
      }
    }
  }
}

/**
 * Fake timer queue: calls to setTimer are collected; `advance(n)` fires
 * timers whose delays (tracked against a virtual clock) have elapsed.
 */
export class FakeTimers {
  private handle = 0
  private now = 0
  private pending = new Map<number, { runAt: number; fn: () => void }>()

  setTimer = (fn: () => void, ms: number): number => {
    const id = ++this.handle
    this.pending.set(id, { runAt: this.now + ms, fn })
    return id
  }

  clearTimer = (id: unknown): void => {
    this.pending.delete(id as number)
  }

  /** Advance virtual time by `ms` and run everything due. */
  advance(ms: number): void {
    this.now += ms
    const ready: Array<{ id: number; fn: () => void; runAt: number }> = []
    for (const [id, entry] of this.pending) {
      if (entry.runAt <= this.now) ready.push({ id, fn: entry.fn, runAt: entry.runAt })
    }
    ready.sort((a, b) => a.runAt - b.runAt)
    for (const r of ready) {
      this.pending.delete(r.id)
      r.fn()
    }
  }

  size(): number {
    return this.pending.size
  }
}

export function helloAck(
  over?: Partial<{ serverId: string; serverSeq: number; epoch: number; protocolSupported: number[] }>,
): Envelope {
  return makeEnvelope(
    HELLO_ACK_CHANNEL,
    [
      {
        serverId: over?.serverId ?? 'server-xyz',
        serverSeq: over?.serverSeq ?? 0,
        epoch: over?.epoch ?? 1,
        protocolSupported: over?.protocolSupported ?? [PROTOCOL_VERSION],
      },
    ],
    { ts: 0 },
  )
}

export function helloRejected(
  reason: 'unsupported-version' | 'invalid-session' | 'revoked' | 'client-outdated',
): Envelope {
  return makeEnvelope(HELLO_REJECTED_CHANNEL, [{ reason }], { ts: 0 })
}
