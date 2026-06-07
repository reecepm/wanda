import { HELLO_ACK_CHANNEL, HELLO_REJECTED_CHANNEL, makeEnvelope, PROTOCOL_VERSION } from '@wanda/wire'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { bootHarness, connectAndHello, type Harness, TestClient, waitMs } from './helpers.ts'

describe('Gateway end-to-end', () => {
  let harness: Harness
  const cleanups: Array<() => void | Promise<void>> = []

  afterEach(async () => {
    while (cleanups.length > 0) {
      try {
        await cleanups.pop()!()
      } catch {
        /* best-effort */
      }
    }
    if (harness) await harness.cleanup()
  })

  async function pairClient(clientId = 'client-A', deviceLabel = 'laptop') {
    const session = harness.sessionStore.createSession({ clientId, deviceLabel })
    const { wsToken } = harness.sessionStore.issueWsToken(session.sessionId)
    return { session, wsToken }
  }

  describe('WS upgrade auth', () => {
    it('rejects upgrade without a wsToken', async () => {
      harness = await bootHarness()
      const ws = new WebSocket(harness.baseUrl.replace(/^http/, 'ws') + '/events')
      cleanups.push(() => ws.close())
      const result: Promise<string> = new Promise((resolve) => {
        let reason = ''
        ws.on('unexpected-response', (_req, res) => {
          reason = `status=${res.statusCode}`
          res.resume()
          resolve(reason)
        })
        ws.on('error', () => resolve('error'))
      })
      const outcome = await result
      expect(outcome).toMatch(/status=401|error/)
    })

    it('rejects a wsToken that was already consumed', async () => {
      harness = await bootHarness()
      const { wsToken } = await pairClient()

      const url = harness.baseUrl.replace(/^http/, 'ws') + '/events?wsToken=' + wsToken
      const first = new WebSocket(url)
      cleanups.push(() => first.close())
      await new Promise<void>((resolve, reject) => {
        first.once('open', resolve)
        first.once('error', reject)
      })

      const second = new WebSocket(url)
      cleanups.push(() => second.close())
      const outcome = await new Promise<'open' | 'error'>((resolve) => {
        second.once('open', () => resolve('open'))
        second.once('error', () => resolve('error'))
        second.once('unexpected-response', () => resolve('error'))
      })
      expect(outcome).toBe('error')
    })
  })

  describe('hello handshake', () => {
    it('completes hello-ack with serverId, epoch, protocolSupported', async () => {
      harness = await bootHarness()
      const { wsToken } = await pairClient()
      const { client, ack } = await connectAndHello({
        baseUrl: harness.baseUrl,
        wsToken,
        clientId: 'client-A',
      })
      cleanups.push(() => client.close())
      expect(ack.channel).toBe(HELLO_ACK_CHANNEL)
      const body = ack.args[0] as {
        serverId: string
        serverSeq: number
        epoch: number
        protocolSupported: number[]
      }
      expect(body.serverId).toMatch(/^[a-f0-9]{32}$/)
      expect(body.epoch).toBe(harness.sessionStore.identity().epoch)
      expect(body.protocolSupported).toContain(PROTOCOL_VERSION)
    })

    it('rejects hello with malformed payload', async () => {
      harness = await bootHarness()
      const { wsToken } = await pairClient()
      const url = harness.baseUrl.replace(/^http/, 'ws') + '/events?wsToken=' + wsToken
      const client = new TestClient(url)
      cleanups.push(() => client.close())
      await client.opened()
      // Empty hello body — missing clientId
      client.send(makeEnvelope('sys:hello', [{ v: PROTOCOL_VERSION }]))
      const rejected = await client.waitFor(HELLO_REJECTED_CHANNEL, 2000)
      expect((rejected.args[0] as { reason: string }).reason).toBe('unsupported-version')
      const closed = await client.waitForClose()
      expect(closed.code).toBe(1002)
    })

    it('rejects hello after the socket is already ready', async () => {
      harness = await bootHarness()
      const { wsToken } = await pairClient()
      const { client } = await connectAndHello({
        baseUrl: harness.baseUrl,
        wsToken,
        clientId: 'client-A',
      })
      cleanups.push(() => client.close())
      // Send a second hello — should close with 1002.
      client.send(makeEnvelope('sys:hello', [{ v: PROTOCOL_VERSION, clientId: 'client-A' }]))
      const closed = await client.waitForClose()
      expect(closed.code).toBe(1002)
    })
  })

  describe('subscribe + broadcast', () => {
    it('delivers events matching a subscription to the subscriber only', async () => {
      harness = await bootHarness()
      const { wsToken: tokenA } = await pairClient('client-A', 'laptop')
      const { wsToken: tokenB } = await pairClient('client-B', 'desktop')

      const a = await connectAndHello({ baseUrl: harness.baseUrl, wsToken: tokenA, clientId: 'client-A' })
      const b = await connectAndHello({ baseUrl: harness.baseUrl, wsToken: tokenB, clientId: 'client-B' })
      cleanups.push(() => a.client.close())
      cleanups.push(() => b.client.close())

      // A subscribes to pod-list for workspace ws-1. B does not.
      a.client.send(makeEnvelope('sys:subscribe', [{ kind: 'pod-list', scope: 'ws-1', requestId: 'r1' }]))
      const subscribed = await a.client.waitFor('sys:subscribed', 2000)
      expect(typeof (subscribed.args[0] as { subscriptionId: string }).subscriptionId).toBe('string')
      expect((subscribed.args[0] as { requestId: string }).requestId).toBe('r1')

      // Publish an event on the event-log for pod-list/ws-1. The gateway's
      // current wiring does NOT auto-route event-log entries — that's the
      // job of the middleware (Phase 6+). We invoke the subscription
      // manager directly to exercise the broadcast path.
      const rec = harness.eventLog.publish('event:pod:created', 'pod', 'pod-1', {
        pod: { id: 'pod-1', name: 'fresh' },
      })
      const env = makeEnvelope('event:pod:created', [{ pod: { id: 'pod-1', name: 'fresh' } }], {
        seq: rec.seq,
        ts: rec.ts,
      })
      const result = harness.subscriptions.publishEvent('pod-list', 'ws-1', env)
      expect(result.delivered).toBe(1)

      const got = await a.client.waitFor('event:pod:created', 1000)
      expect(got.seq).toBe(rec.seq)
      // B never subscribed — no event for them.
      expect(b.client.received.find((e) => e.channel === 'event:pod:created')).toBeUndefined()
    })

    it('dedups subscribe with same requestId inside one connection', async () => {
      harness = await bootHarness()
      const { wsToken } = await pairClient()
      const { client } = await connectAndHello({
        baseUrl: harness.baseUrl,
        wsToken,
        clientId: 'client-A',
      })
      cleanups.push(() => client.close())

      client.send(makeEnvelope('sys:subscribe', [{ kind: 'pod-list', scope: 'ws-1', requestId: 'r1' }]))
      const first = await client.waitFor('sys:subscribed', 2000)
      client.send(makeEnvelope('sys:subscribe', [{ kind: 'pod-list', scope: 'ws-1', requestId: 'r1' }]))
      // Collect the second subscribed; the channel appears twice so waitFor
      // returns the first one we already consumed. Use a direct await of the
      // collector instead.
      await waitMs(100)
      const subscribed = client.received.filter((e) => e.channel === 'sys:subscribed')
      expect(subscribed).toHaveLength(2)
      expect((subscribed[0]!.args[0] as { subscriptionId: string }).subscriptionId).toBe(
        (subscribed[1]!.args[0] as { subscriptionId: string }).subscriptionId,
      )
      expect((subscribed[0]!.args[0] as { requestId: string }).requestId).toBe('r1')
      expect((subscribed[1]!.args[0] as { requestId: string }).requestId).toBe('r1')
      expect(first).toBeDefined()
    })

    it('unsubscribe stops delivery', async () => {
      harness = await bootHarness()
      const { wsToken } = await pairClient()
      const { client } = await connectAndHello({
        baseUrl: harness.baseUrl,
        wsToken,
        clientId: 'client-A',
      })
      cleanups.push(() => client.close())

      client.send(makeEnvelope('sys:subscribe', [{ kind: 'pod-list', scope: 'ws-1', requestId: 'r1' }]))
      const subscribed = await client.waitFor('sys:subscribed', 2000)
      const subId = (subscribed.args[0] as { subscriptionId: string }).subscriptionId

      client.send(makeEnvelope('sys:unsubscribe', [{ subscriptionId: subId }]))
      await waitMs(50)

      const env = makeEnvelope('event:pod:created', [{}], { seq: 1, ts: 0 })
      const result = harness.subscriptions.publishEvent('pod-list', 'ws-1', env)
      expect(result.delivered).toBe(0)
    })

    it('drops every subscription when the WS closes', async () => {
      harness = await bootHarness()
      const { wsToken } = await pairClient()
      const { client } = await connectAndHello({
        baseUrl: harness.baseUrl,
        wsToken,
        clientId: 'client-A',
      })
      client.send(makeEnvelope('sys:subscribe', [{ kind: 'pod-list', scope: 'ws-1', requestId: 'r1' }]))
      await client.waitFor('sys:subscribed', 2000)
      expect(harness.subscriptions.count()).toBe(1)

      client.close()
      // Wait for the server to observe the close.
      const waitCloseDeadline = Date.now() + 2000
      while (harness.subscriptions.count() > 0 && Date.now() < waitCloseDeadline) {
        await waitMs(25)
      }
      expect(harness.subscriptions.count()).toBe(0)
      expect(harness.gateway.openConnections()).toBe(0)
    })
  })

  describe('replay', () => {
    it('streams events after sinceSeq then sends replay-complete', async () => {
      harness = await bootHarness()
      const { wsToken } = await pairClient()

      // Pre-populate events at epoch 1.
      for (let i = 0; i < 5; i++) {
        harness.eventLog.publish('event:pod:created', 'pod', `p${i}`, { i })
      }

      const { client, ack } = await connectAndHello({
        baseUrl: harness.baseUrl,
        wsToken,
        clientId: 'client-A',
      })
      cleanups.push(() => client.close())
      const ackBody = ack.args[0] as { epoch: number; serverSeq: number }

      client.send(makeEnvelope('sys:replay-from', [{ sinceSeq: 0, sinceEpoch: ackBody.epoch }]))
      const complete = await client.waitFor('sys:replay-complete', 2000)
      expect(complete.channel).toBe('sys:replay-complete')

      const events = client.received.filter((e) => e.channel === 'event:pod:created')
      expect(events).toHaveLength(5)
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
    })

    it('returns replay-gone on epoch mismatch', async () => {
      harness = await bootHarness()
      const { wsToken } = await pairClient()
      harness.eventLog.publish('event:pod:created', 'pod', 'p1', {})

      const { client, ack } = await connectAndHello({
        baseUrl: harness.baseUrl,
        wsToken,
        clientId: 'client-A',
      })
      cleanups.push(() => client.close())
      const ackBody = ack.args[0] as { epoch: number }

      client.send(makeEnvelope('sys:replay-from', [{ sinceSeq: 0, sinceEpoch: ackBody.epoch + 99 }]))
      const gone = await client.waitFor('sys:replay-gone', 2000)
      expect((gone.args[0] as { reason: string }).reason).toBe('epoch-mismatch')
    })
  })

  describe('keepalive + idle timeout', () => {
    it('sends periodic sys:ping envelopes to an idle client', async () => {
      harness = await bootHarness({ pingIntervalMs: 100, pingTimeoutMs: 10_000 })
      const { wsToken } = await pairClient()
      const { client } = await connectAndHello({
        baseUrl: harness.baseUrl,
        wsToken,
        clientId: 'client-A',
      })
      cleanups.push(() => client.close())
      const ping = await client.waitFor('sys:ping', 1500)
      expect(ping.channel).toBe('sys:ping')
    })

    it('drops a connection that goes silent past the timeout', async () => {
      harness = await bootHarness({ pingIntervalMs: 50, pingTimeoutMs: 120 })
      const { wsToken } = await pairClient()
      const { client } = await connectAndHello({
        baseUrl: harness.baseUrl,
        wsToken,
        clientId: 'client-A',
      })
      cleanups.push(() => client.close())

      // Discard the ws "message" listener that updates lastInboundAt by
      // silencing our client — we just let the server's ping come in, which
      // doesn't reset the server's own lastInboundAt clock.
      const closed = await client.waitForClose(3000)
      expect(closed.code).toBe(1001)
      expect(closed.reason).toBe('idle-timeout')
    })
  })

  describe('grace window on disconnect', () => {
    it('markDisconnected is called when the WS closes, eligible for reuse within grace', async () => {
      harness = await bootHarness()
      const { wsToken, session } = await pairClient()
      const { client } = await connectAndHello({
        baseUrl: harness.baseUrl,
        wsToken,
        clientId: session.clientId,
      })
      client.close()

      // The gateway's close listener should have called markDisconnected.
      const waitDeadline = Date.now() + 1000
      while (!harness.sessionStore.isWithinGrace(session.clientId) && Date.now() < waitDeadline) {
        await waitMs(20)
      }
      expect(harness.sessionStore.isWithinGrace(session.clientId)).toBe(true)
    })
  })
})
