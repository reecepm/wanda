// -----------------------------------------------------------------------------
// End-to-end helpers for gateway tests:
//   - Spin up a real HTTP server on a random port
//   - Wire a Gateway against fresh on-disk SQLite (session + event-log)
//   - Open a WS client, expose a typed send/receive helper
//
// Everything on-disk (not :memory:) so WAL and BEGIN IMMEDIATE semantics
// match production.
// -----------------------------------------------------------------------------

import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server as HttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { type EventLog, openEventLog } from '@wanda/event-log'
import { SessionStore } from '@wanda/session'
import { SubscriptionManager } from '@wanda/subscriptions'
import {
  decodeEnvelope,
  type Envelope,
  encodeEnvelope,
  HELLO_ACK_CHANNEL,
  HELLO_REJECTED_CHANNEL,
  makeEnvelope,
  PROTOCOL_VERSION,
} from '@wanda/wire'
import Database from 'better-sqlite3'
import { WebSocket } from 'ws'
import { Gateway } from '../gateway.ts'

export interface Harness {
  readonly gateway: Gateway
  readonly http: HttpServer
  readonly port: number
  readonly baseUrl: string
  readonly sessionStore: SessionStore
  readonly eventLog: EventLog
  readonly subscriptions: SubscriptionManager
  readonly cleanup: () => Promise<void>
}

export async function bootHarness(opts?: { pingIntervalMs?: number; pingTimeoutMs?: number }): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'wanda-gateway-test-'))
  const eventPath = join(dir, 'events.db')
  const sessionPath = join(dir, 'session.db')

  const eventLog = openEventLog(eventPath, { epoch: 1 })

  const sessionDb = new Database(sessionPath)
  const sessionStore = new SessionStore(sessionDb, { ownsDb: true })

  const subscriptions = new SubscriptionManager()

  const http = createServer()
  // Listen on random port.
  const port: number = await new Promise((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', () => {
      const addr = http.address()
      if (!addr || typeof addr === 'string') reject(new Error('no address'))
      else resolve(addr.port)
    })
  })

  const gateway = new Gateway({
    httpServer: http,
    sessionStore,
    eventLog,
    subscriptions,
    pingIntervalMs: opts?.pingIntervalMs,
    pingTimeoutMs: opts?.pingTimeoutMs,
  })
  gateway.start()

  return {
    gateway,
    http,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    sessionStore,
    eventLog,
    subscriptions,
    cleanup: async () => {
      await gateway.stop()
      eventLog.close()
      sessionStore.close()
      await new Promise<void>((resolve) => http.close(() => resolve()))
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    },
  }
}

/** Minimal WS client with a collector queue — all received envelopes are
 *  stashed so tests can await specific channels. */
export class TestClient {
  readonly received: Envelope[] = []
  private readonly waiters = new Map<string, Array<(env: Envelope) => void>>()
  readonly ws: WebSocket

  constructor(url: string) {
    this.ws = new WebSocket(url)
    this.ws.on('message', (raw) => {
      if (typeof raw !== 'string' && !(raw instanceof Buffer)) return
      const text = typeof raw === 'string' ? raw : raw.toString('utf8')
      const result = decodeEnvelope(text)
      if (!result.ok) return
      this.received.push(result.envelope)
      const list = this.waiters.get(result.envelope.channel)
      if (list) {
        const cb = list.shift()
        if (cb) cb(result.envelope)
        if (list.length === 0) this.waiters.delete(result.envelope.channel)
      }
    })
  }

  async opened(timeoutMs = 2000): Promise<void> {
    if (this.ws.readyState === 1) return
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws open timeout')), timeoutMs)
      this.ws.once('open', () => {
        clearTimeout(t)
        resolve()
      })
      this.ws.once('error', (err) => {
        clearTimeout(t)
        reject(err)
      })
    })
  }

  send(env: Envelope): void {
    this.ws.send(encodeEnvelope(env))
  }

  async waitFor(channel: string, timeoutMs = 3000): Promise<Envelope> {
    const existing = this.received.find((e) => e.channel === channel)
    if (existing) return existing
    return await new Promise<Envelope>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${channel}`)), timeoutMs)
      const list = this.waiters.get(channel) ?? []
      list.push((env) => {
        clearTimeout(t)
        resolve(env)
      })
      this.waiters.set(channel, list)
    })
  }

  async waitForClose(timeoutMs = 3000): Promise<{ code: number; reason: string }> {
    if (this.ws.readyState === this.ws.CLOSED) {
      return { code: 1000, reason: '' }
    }
    return await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('close timeout')), timeoutMs)
      this.ws.once('close', (code: number, reason: Buffer) => {
        clearTimeout(t)
        resolve({ code, reason: reason.toString('utf8') })
      })
    })
  }

  close(): void {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

/** One-liner: open a WS, run the hello handshake, return a ready client. */
export async function connectAndHello(opts: {
  baseUrl: string
  wsToken: string
  clientId: string
  sessionId?: string
  resumeFromSeq?: number
  epoch?: number
}): Promise<{ client: TestClient; ack: Envelope }> {
  const wsUrl = opts.baseUrl.replace(/^http/, 'ws') + '/events?wsToken=' + encodeURIComponent(opts.wsToken)
  const client = new TestClient(wsUrl)
  await client.opened()
  const helloPayload: Record<string, unknown> = { v: PROTOCOL_VERSION, clientId: opts.clientId }
  if (opts.sessionId) helloPayload.sessionId = opts.sessionId
  if (opts.resumeFromSeq != null) helloPayload.resumeFromSeq = opts.resumeFromSeq
  if (opts.epoch != null) helloPayload.epoch = opts.epoch
  client.send(makeEnvelope('sys:hello', [helloPayload]))
  const ack = await client.waitFor(HELLO_ACK_CHANNEL, 2000).catch(async (err) => {
    // Surface a hello-rejected for diagnostic clarity.
    const rejected = client.received.find((e) => e.channel === HELLO_REJECTED_CHANNEL)
    if (rejected) throw new Error(`hello rejected: ${JSON.stringify(rejected.args)}`)
    throw err
  })
  return { client, ack }
}

export async function waitMs(ms: number): Promise<void> {
  await delay(ms)
}
