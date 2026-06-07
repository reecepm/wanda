import { decodeEnvelope, type Envelope, HELLO_CHANNEL, makeEnvelope } from '@wanda/wire'
import { describe, expect, it, vi } from 'vitest'
import { ClientConnection } from '../client-connection.ts'
import type { ResumeCursor } from '../types.ts'
import { FakeTimers, helloAck, helloRejected, MockWebSocket } from './helpers.ts'

interface Harness {
  conn: ClientConnection
  sockets: MockWebSocket[]
  latestSocket: () => MockWebSocket
  timers: FakeTimers
  states: string[]
  events: Envelope[]
  replayCompletions: Envelope[]
  replayGone: Envelope[]
  helloAcks: Array<{ serverId: string; serverSeq: number; epoch: number }>
  helloRejections: string[]
  onReadyCalls: number
  onFullResyncReasons: string[]
  cursor: { value: ResumeCursor; set: (c: ResumeCursor) => void }
}

function setupHarness(opts?: {
  initialCursor?: ResumeCursor
  onFullResyncNeeded?: (reason: string) => Promise<void>
  backoffMs?: readonly number[]
}): Harness {
  const sockets: MockWebSocket[] = []
  const timers = new FakeTimers()
  const states: string[] = []
  const events: Envelope[] = []
  const replayCompletions: Envelope[] = []
  const replayGone: Envelope[] = []
  const helloAcks: Array<{ serverId: string; serverSeq: number; epoch: number }> = []
  const helloRejections: string[] = []
  let onReadyCalls = 0
  const onFullResyncReasons: string[] = []

  const cursor = {
    value: opts?.initialCursor ?? { seq: 0, epoch: null },
    set(c: ResumeCursor) {
      this.value = c
    },
  }

  let wsTokenCounter = 0
  const conn = new ClientConnection({
    clientId: 'client-A',
    getUrl: () => 'ws://127.0.0.1:9999/events',
    issueWsToken: async () => `ws-${++wsTokenCounter}`,
    getResumeCursor: () => cursor.value,
    webSocketFactory: (url) => {
      const s = new MockWebSocket(url)
      sockets.push(s)
      return s
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    backoffMs: opts?.backoffMs ?? [100, 200, 400],
    onStateChange: (s) => states.push(s),
    onEventEnvelope: (e) => events.push(e),
    onReplayComplete: (e) => replayCompletions.push(e),
    onReplayGone: (e) => replayGone.push(e),
    onHelloAck: (a) => helloAcks.push(a),
    onHelloRejected: (r) => helloRejections.push(r),
    onFullResyncNeeded: async (r) => {
      onFullResyncReasons.push(r)
      await opts?.onFullResyncNeeded?.(r)
    },
    onReady: () => {
      onReadyCalls++
    },
  })

  return {
    conn,
    sockets,
    latestSocket: () => sockets[sockets.length - 1]!,
    timers,
    states,
    events,
    replayCompletions,
    replayGone,
    helloAcks,
    helloRejections,
    get onReadyCalls() {
      return onReadyCalls
    },
    onFullResyncReasons,
    cursor,
  } as Harness
}

async function flushMicrotasks(): Promise<void> {
  // Settings onHelloAck / onReady triggers `await` promises; yield the
  // microtask queue so state transitions settle before assertions.
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('ClientConnection FSM', () => {
  describe('happy path', () => {
    it('idle → connecting → recovering → connected with replay-complete', async () => {
      const h = setupHarness()
      h.conn.start()
      // start → connect() → transitions to 'connecting'. getUrl/issueWsToken are
      // async so wait a tick for the socket to materialize.
      await flushMicrotasks()
      expect(h.conn.state()).toBe('connecting')
      expect(h.sockets).toHaveLength(1)

      h.latestSocket().simulateOpen()
      expect(h.latestSocket().sentChannels()).toEqual([HELLO_CHANNEL])

      h.latestSocket().simulateMessage(helloAck({ serverSeq: 5, epoch: 1 }))
      await flushMicrotasks()
      expect(h.helloAcks).toHaveLength(1)
      expect(h.helloAcks[0]!.epoch).toBe(1)
      expect(h.conn.state()).toBe('recovering')
      // Replay-from issued after hello-ack.
      expect(h.latestSocket().sent.map((e) => e.channel)).toContain('sys:replay-from')

      // Server streams a couple of events and then replay-complete.
      h.latestSocket().simulateMessage(makeEnvelope('event:pod:created', [{ pod: { id: 'p1' } }], { seq: 1, ts: 0 }))
      h.latestSocket().simulateMessage(makeEnvelope('sys:replay-complete', [{ serverSeq: 1 }], { ts: 0 }))
      await flushMicrotasks()
      expect(h.conn.state()).toBe('connected')
      expect(h.onReadyCalls).toBe(1)
      expect(h.events.map((e) => e.channel)).toEqual(['event:pod:created'])
    })

    it('forwards live event envelopes after ready', async () => {
      const h = setupHarness()
      h.conn.start()
      await flushMicrotasks()
      h.latestSocket().simulateOpen()
      h.latestSocket().simulateMessage(helloAck())
      await flushMicrotasks()
      h.latestSocket().simulateMessage(makeEnvelope('sys:replay-complete', [{ serverSeq: 0 }]))
      await flushMicrotasks()

      h.latestSocket().simulateMessage(makeEnvelope('event:workspace:created', [{ ws: {} }], { seq: 1, ts: 0 }))
      expect(h.events).toHaveLength(1)
      expect(h.events[0]!.channel).toBe('event:workspace:created')
    })

    it('forwards scoped replay completion without changing connection recovery state', async () => {
      const h = setupHarness()
      h.conn.start()
      await flushMicrotasks()
      h.latestSocket().simulateOpen()
      h.latestSocket().simulateMessage(helloAck())
      await flushMicrotasks()
      h.latestSocket().simulateMessage(makeEnvelope('sys:replay-complete', [{ serverSeq: 0 }]))
      await flushMicrotasks()
      expect(h.conn.state()).toBe('connected')

      h.latestSocket().simulateMessage(
        makeEnvelope('sys:replay-complete', [
          { serverSeq: 2, scope: { kind: 'agentSession', id: 'ses_1' }, requestId: 'r1' },
        ]),
      )

      expect(h.conn.state()).toBe('connected')
      expect(h.replayCompletions).toHaveLength(1)
      expect(h.replayCompletions[0]!.args[0]).toMatchObject({ requestId: 'r1' })
    })

    it('auto-responds to sys:ping with sys:pong', async () => {
      const h = setupHarness()
      h.conn.start()
      await flushMicrotasks()
      h.latestSocket().simulateOpen()
      h.latestSocket().simulateMessage(makeEnvelope('sys:ping', []))
      const pong = h.latestSocket().sent.find((e) => e.channel === 'sys:pong')
      expect(pong).toBeDefined()
    })
  })

  describe('hello-rejected', () => {
    it('transitions to offline and does not retry', async () => {
      const h = setupHarness()
      h.conn.start()
      await flushMicrotasks()
      h.latestSocket().simulateOpen()
      h.latestSocket().simulateMessage(helloRejected('invalid-session'))
      await flushMicrotasks()
      expect(h.helloRejections).toEqual(['invalid-session'])
      expect(h.conn.state()).toBe('offline')
      // No reconnect timer scheduled.
      expect(h.timers.size()).toBe(0)
    })

    it('maps `revoked` to the `unpaired` terminal state', async () => {
      const h = setupHarness()
      h.conn.start()
      await flushMicrotasks()
      h.latestSocket().simulateOpen()
      h.latestSocket().simulateMessage(helloRejected('revoked'))
      await flushMicrotasks()
      expect(h.conn.state()).toBe('unpaired')
    })
  })

  describe('reconnect + backoff', () => {
    it('schedules an exponential backoff sequence on ws close', async () => {
      const h = setupHarness({ backoffMs: [100, 200, 400] })
      h.conn.start()
      await flushMicrotasks()
      // Attempt 1: socket dropped immediately after connect.
      h.sockets[0]!.simulateClose()
      await flushMicrotasks()
      expect(h.conn.state()).toBe('reconnecting')
      expect(h.timers.size()).toBe(1)

      h.timers.advance(100)
      await flushMicrotasks()
      // Attempt 2: new socket opened.
      expect(h.sockets).toHaveLength(2)
      h.sockets[1]!.simulateClose()
      await flushMicrotasks()
      h.timers.advance(200)
      await flushMicrotasks()
      expect(h.sockets).toHaveLength(3)
      h.sockets[2]!.simulateClose()
      await flushMicrotasks()
      h.timers.advance(400)
      await flushMicrotasks()
      expect(h.sockets).toHaveLength(4)
    })

    it('resets backoff after a successful hello-ack', async () => {
      const h = setupHarness({ backoffMs: [50, 100, 200, 400] })
      h.conn.start()
      await flushMicrotasks()
      // Two quick failures to advance the backoff counter.
      h.sockets[0]!.simulateClose()
      await flushMicrotasks()
      h.timers.advance(50)
      await flushMicrotasks()
      h.sockets[1]!.simulateClose()
      await flushMicrotasks()
      h.timers.advance(100)
      await flushMicrotasks()
      // Third attempt succeeds fully.
      h.sockets[2]!.simulateOpen()
      h.sockets[2]!.simulateMessage(helloAck())
      await flushMicrotasks()
      h.sockets[2]!.simulateMessage(makeEnvelope('sys:replay-complete', [{ serverSeq: 0 }]))
      await flushMicrotasks()
      expect(h.conn.state()).toBe('connected')

      // Now drop again — backoff should be back to the first entry (50ms).
      h.sockets[2]!.simulateClose()
      await flushMicrotasks()
      h.timers.advance(49)
      await flushMicrotasks()
      expect(h.sockets).toHaveLength(3) // no new socket yet
      h.timers.advance(1)
      await flushMicrotasks()
      expect(h.sockets).toHaveLength(4)
    })

    it('caps at the last entry when attempts exceed the schedule', async () => {
      const h = setupHarness({ backoffMs: [100, 200] })
      h.conn.start()
      await flushMicrotasks()
      // Drop 5 times; last 3 should all use 200.
      for (let i = 0; i < 5; i++) {
        h.sockets[i]!.simulateClose()
        await flushMicrotasks()
        h.timers.advance(200)
        await flushMicrotasks()
      }
      expect(h.sockets.length).toBeGreaterThanOrEqual(6)
    })
  })

  describe('epoch change / replay-gone', () => {
    it('triggers full-resync on epoch change and reaches connected after resync', async () => {
      const h = setupHarness({ initialCursor: { seq: 5, epoch: 1 } })
      h.conn.start()
      await flushMicrotasks()
      h.latestSocket().simulateOpen()
      // Server advertises a different epoch.
      h.latestSocket().simulateMessage(helloAck({ epoch: 99 }))
      await flushMicrotasks()
      expect(h.onFullResyncReasons).toContain('epoch-changed')
      expect(h.conn.state()).toBe('connected')
      expect(h.onReadyCalls).toBe(1)
    })

    it('triggers full-resync on sys:replay-gone during recovering', async () => {
      const h = setupHarness({ initialCursor: { seq: 10, epoch: 1 } })
      h.conn.start()
      await flushMicrotasks()
      h.latestSocket().simulateOpen()
      h.latestSocket().simulateMessage(helloAck({ epoch: 1 }))
      await flushMicrotasks()
      h.latestSocket().simulateMessage(makeEnvelope('sys:replay-gone', [{ reason: 'too-old' }], { ts: 0 }))
      await flushMicrotasks()
      expect(h.onFullResyncReasons).toContain('replay-gone')
      expect(h.conn.state()).toBe('connected')
    })

    it('forces reconnect when onFullResyncNeeded throws', async () => {
      const h = setupHarness({
        initialCursor: { seq: 10, epoch: 1 },
        onFullResyncNeeded: async () => {
          throw new Error('resync boom')
        },
      })
      h.conn.start()
      await flushMicrotasks()
      h.latestSocket().simulateOpen()
      h.latestSocket().simulateMessage(helloAck({ epoch: 99 }))
      await flushMicrotasks()
      // Must not leave the FSM stuck in `recovering`.
      expect(['reconnecting', 'connecting']).toContain(h.conn.state())
    })
  })

  describe('send buffering during recovering', () => {
    it('queues sends before hello-ack and flushes after replay-complete', async () => {
      const h = setupHarness()
      h.conn.start()
      await flushMicrotasks()
      // Still connecting — queue a subscribe.
      h.conn.send(makeEnvelope('sys:subscribe', [{ kind: 'pod-list', scope: 'ws-1', requestId: 'r1' }]))
      h.latestSocket().simulateOpen()
      // Hello sent. The subscribe should NOT have landed yet.
      expect(h.latestSocket().sentChannels()).toEqual(['sys:hello'])

      h.latestSocket().simulateMessage(helloAck())
      await flushMicrotasks()
      // In recovering — subscribe still buffered.
      expect(
        h
          .latestSocket()
          .sentChannels()
          .filter((c) => c === 'sys:subscribe'),
      ).toHaveLength(0)

      h.latestSocket().simulateMessage(makeEnvelope('sys:replay-complete', [{ serverSeq: 0 }]))
      await flushMicrotasks()
      expect(
        h
          .latestSocket()
          .sentChannels()
          .filter((c) => c === 'sys:subscribe'),
      ).toHaveLength(1)
    })

    it('send while connected writes directly', async () => {
      const h = setupHarness()
      h.conn.start()
      await flushMicrotasks()
      h.latestSocket().simulateOpen()
      h.latestSocket().simulateMessage(helloAck())
      await flushMicrotasks()
      h.latestSocket().simulateMessage(makeEnvelope('sys:replay-complete', [{ serverSeq: 0 }]))
      await flushMicrotasks()
      expect(h.conn.state()).toBe('connected')

      h.conn.send(makeEnvelope('sys:unsubscribe', [{ subscriptionId: 'x' }]))
      expect(h.latestSocket().sentChannels()).toContain('sys:unsubscribe')
    })

    it('send while offline is a silent drop', async () => {
      const h = setupHarness()
      h.conn.start()
      await flushMicrotasks()
      h.latestSocket().simulateOpen()
      h.latestSocket().simulateMessage(helloRejected('invalid-session'))
      await flushMicrotasks()
      expect(h.conn.state()).toBe('offline')
      // send should not throw; there's no socket open to send on.
      expect(() => h.conn.send(makeEnvelope('sys:subscribe', [{}]))).not.toThrow()
    })
  })

  describe('stop()', () => {
    it('tears down without firing another reconnect', async () => {
      const h = setupHarness()
      h.conn.start()
      await flushMicrotasks()
      h.latestSocket().simulateOpen()
      await h.conn.stop()
      expect(h.conn.state()).toBe('stopped')
      h.timers.advance(10_000)
      await flushMicrotasks()
      expect(h.sockets).toHaveLength(1) // no new socket created
    })
  })

  describe('hello payload', () => {
    it('omits resumeFromSeq / epoch on a fresh cursor', async () => {
      const h = setupHarness({ initialCursor: { seq: 0, epoch: null } })
      h.conn.start()
      await flushMicrotasks()
      h.latestSocket().simulateOpen()
      const hello = h.latestSocket().sent[0]!
      const body = hello.args[0] as Record<string, unknown>
      expect(body.clientId).toBe('client-A')
      expect(body.resumeFromSeq).toBeUndefined()
      expect(body.epoch).toBeUndefined()
    })

    it('includes resumeFromSeq + epoch when the cursor has advanced', async () => {
      const h = setupHarness({ initialCursor: { seq: 42, epoch: 7 } })
      h.conn.start()
      await flushMicrotasks()
      h.latestSocket().simulateOpen()
      const hello = h.latestSocket().sent[0]!
      const body = hello.args[0] as Record<string, unknown>
      expect(body.resumeFromSeq).toBe(42)
      expect(body.epoch).toBe(7)
    })
  })

  describe('error isolation', () => {
    it('a throwing onStateChange listener does not break the FSM', async () => {
      const sockets: MockWebSocket[] = []
      const timers = new FakeTimers()
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      let wsTokenCounter = 0
      const conn = new ClientConnection({
        clientId: 'x',
        getUrl: () => 'ws://127.0.0.1:9/events',
        issueWsToken: async () => `ws-${++wsTokenCounter}`,
        getResumeCursor: () => ({ seq: 0, epoch: null }),
        webSocketFactory: (url) => {
          const s = new MockWebSocket(url)
          sockets.push(s)
          return s
        },
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        onStateChange: () => {
          throw new Error('state listener boom')
        },
      })
      conn.start()
      await flushMicrotasks()
      expect(conn.state()).toBe('connecting')
      spy.mockRestore()
    })
  })
})

describe('decodeEnvelope sanity — test doubles only forward valid envelopes', () => {
  it('is a smoke test for helpers.ts', () => {
    const raw = decodeEnvelope('{"v":1,"seq":0,"ts":0,"channel":"sys:ping","args":[]}')
    expect(raw.ok).toBe(true)
  })
})
