// -----------------------------------------------------------------------------
// End-to-end coverage for `sys:replay-from-scoped`. Mirrors the existing
// `sys:replay-from` test shape: publish events into the event-log, then
// drive the handler over a real WS round-trip and assert we get exactly the
// scoped subset in order, followed by `sys:replay-complete`.
// -----------------------------------------------------------------------------

import { makeEnvelope } from '@wanda/wire'
import { afterEach, describe, expect, it } from 'vitest'
import { bootHarness, connectAndHello, type Harness } from './helpers.ts'

describe('Gateway sys:replay-from-scoped', () => {
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

  it('streams only events for the requested (kind, id) then replay-complete', async () => {
    harness = await bootHarness()
    // Events on two sessions; only sessA should come back.
    const a1 = harness.eventLog.publish('event:agentSession:event', 'agentSession', 'sessA', {
      schemaVersion: 1,
      event: { kind: 'turn.started', sessionId: 'sessA', turnId: 't1' },
    })
    harness.eventLog.publish('event:agentSession:event', 'agentSession', 'sessB', {
      schemaVersion: 1,
      event: { kind: 'turn.started', sessionId: 'sessB', turnId: 't1' },
    })
    const a2 = harness.eventLog.publish('event:agentSession:event', 'agentSession', 'sessA', {
      schemaVersion: 1,
      event: { kind: 'text.completed', sessionId: 'sessA', turnId: 't1', messageId: 'm1', text: 'hi' },
    })

    const { wsToken } = await pairClient()
    const { client } = await connectAndHello({
      baseUrl: harness.baseUrl,
      wsToken,
      clientId: 'client-A',
    })
    cleanups.push(() => client.close())

    client.send(
      makeEnvelope('sys:replay-from-scoped', [
        {
          sinceSeq: 0,
          sinceEpoch: 1,
          scope: { kind: 'agentSession', id: 'sessA' },
        },
      ]),
    )

    const done = await client.waitFor('sys:replay-complete', 2000)
    expect(done.channel).toBe('sys:replay-complete')

    const events = client.received.filter((e) => e.channel === 'event:agentSession:event')
    expect(events).toHaveLength(2)
    expect(events[0]!.seq).toBe(a1.seq)
    expect(events[1]!.seq).toBe(a2.seq)
    expect((events[0]!.args[0] as { seq: number }).seq).toBe(a1.seq)
    expect((events[1]!.args[0] as { seq: number }).seq).toBe(a2.seq)
    expect(events.every((e) => (e.args[0] as { resourceId: string }).resourceId === 'sessA')).toBe(true)
  })

  it('cold-load scoped replay streams the requested resource across epochs', async () => {
    harness = await bootHarness()
    const oldEpoch = harness.eventLog.publish('event:agentSession:event', 'agentSession', 'sessA', {
      schemaVersion: 1,
      event: { kind: 'turn.started', sessionId: 'sessA', turnId: 't-old' },
    })
    harness.eventLog.publish('event:agentSession:event', 'agentSession', 'sessB', {
      schemaVersion: 1,
      event: { kind: 'turn.started', sessionId: 'sessB', turnId: 't-other' },
    })
    harness.eventLog.setEpoch(2)
    const newEpoch = harness.eventLog.publish('event:agentSession:event', 'agentSession', 'sessA', {
      schemaVersion: 1,
      event: {
        kind: 'text.completed',
        sessionId: 'sessA',
        turnId: 't-new',
        messageId: 'm-new',
        text: 'after restart',
      },
    })

    const { wsToken } = await pairClient()
    const { client } = await connectAndHello({
      baseUrl: harness.baseUrl,
      wsToken,
      clientId: 'client-A',
    })
    cleanups.push(() => client.close())

    client.send(
      makeEnvelope('sys:replay-from-scoped', [
        {
          sinceSeq: 0,
          sinceEpoch: 2,
          scope: { kind: 'agentSession', id: 'sessA' },
        },
      ]),
    )

    await client.waitFor('sys:replay-complete', 2000)
    const events = client.received.filter((e) => e.channel === 'event:agentSession:event')
    expect(events.map((e) => e.seq)).toEqual([oldEpoch.seq, newEpoch.seq])
  })

  it('respects upToSeq as an exclusive upper bound', async () => {
    harness = await bootHarness()
    const r1 = harness.eventLog.publish('event:agentSession:event', 'agentSession', 'sessA', {
      schemaVersion: 1,
      event: { kind: 'turn.started', sessionId: 'sessA', turnId: 't1' },
    })
    const r2 = harness.eventLog.publish('event:agentSession:event', 'agentSession', 'sessA', {
      schemaVersion: 1,
      event: { kind: 'text.delta', sessionId: 'sessA', turnId: 't1', messageId: 'm1', text: 'a', index: 0 },
    })
    harness.eventLog.publish('event:agentSession:event', 'agentSession', 'sessA', {
      schemaVersion: 1,
      event: { kind: 'text.delta', sessionId: 'sessA', turnId: 't1', messageId: 'm1', text: 'b', index: 1 },
    })

    const { wsToken } = await pairClient()
    const { client } = await connectAndHello({
      baseUrl: harness.baseUrl,
      wsToken,
      clientId: 'client-A',
    })
    cleanups.push(() => client.close())

    client.send(
      makeEnvelope('sys:replay-from-scoped', [
        {
          sinceSeq: 0,
          sinceEpoch: 1,
          upToSeq: r2.seq,
          scope: { kind: 'agentSession', id: 'sessA' },
        },
      ]),
    )

    await client.waitFor('sys:replay-complete', 2000)
    const events = client.received.filter((e) => e.channel === 'event:agentSession:event')
    expect(events.map((e) => e.seq)).toEqual([r1.seq, r2.seq])
  })

  it('returns sys:replay-gone on epoch-mismatch', async () => {
    harness = await bootHarness()
    harness.eventLog.publish('event:agentSession:event', 'agentSession', 'sessA', {
      schemaVersion: 1,
      event: { kind: 'turn.started', sessionId: 'sessA', turnId: 't1' },
    })

    const { wsToken } = await pairClient()
    const { client } = await connectAndHello({
      baseUrl: harness.baseUrl,
      wsToken,
      clientId: 'client-A',
    })
    cleanups.push(() => client.close())

    client.send(
      makeEnvelope('sys:replay-from-scoped', [
        {
          sinceSeq: 1,
          sinceEpoch: 999,
          scope: { kind: 'agentSession', id: 'sessA' },
        },
      ]),
    )

    const gone = await client.waitFor('sys:replay-gone', 2000)
    expect((gone.args[0] as { reason: string }).reason).toBe('epoch-mismatch')
  })

  it('returns sys:replay-gone with invalid-cursor on bad args', async () => {
    harness = await bootHarness()
    const { wsToken } = await pairClient()
    const { client } = await connectAndHello({
      baseUrl: harness.baseUrl,
      wsToken,
      clientId: 'client-A',
    })
    cleanups.push(() => client.close())

    // Missing scope.
    client.send(makeEnvelope('sys:replay-from-scoped', [{ sinceSeq: 0, sinceEpoch: 1 }]))
    const gone = await client.waitFor('sys:replay-gone', 2000)
    expect((gone.args[0] as { reason: string }).reason).toBe('invalid-cursor')
  })

  it('rejects unknown resource kinds as invalid-cursor', async () => {
    harness = await bootHarness()
    const { wsToken } = await pairClient()
    const { client } = await connectAndHello({
      baseUrl: harness.baseUrl,
      wsToken,
      clientId: 'client-A',
    })
    cleanups.push(() => client.close())

    client.send(
      makeEnvelope('sys:replay-from-scoped', [{ sinceSeq: 0, sinceEpoch: 1, scope: { kind: 'nope', id: 'x' } }]),
    )
    const gone = await client.waitFor('sys:replay-gone', 2000)
    expect((gone.args[0] as { reason: string }).reason).toBe('invalid-cursor')
  })
})
