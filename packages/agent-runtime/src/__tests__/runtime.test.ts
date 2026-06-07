// -----------------------------------------------------------------------------
// End-to-end integration: AgentRuntime + mockProvider + real
// SubscriptionManager + stub EventLog. Drives create → prompt → cancel →
// close and asserts on the published event stream.
// -----------------------------------------------------------------------------

import {
  AGENT_SESSION_EVENT_CHANNEL,
  type AgentEvent,
  type AgentEventEnvelope,
  type ProviderId,
} from '@wanda/agent-protocol'
import type { EventLog, EventRecord, PublishBatchInput } from '@wanda/event-log'
import { type Connection, SubscriptionManager } from '@wanda/subscriptions'
import type { Envelope, EventChannel, ResourceKind } from '@wanda/wire'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockProvider } from '../mock-provider.ts'
import { makeAgentRuntime } from '../runtime.ts'

// --- In-memory stub EventLog -------------------------------------------------

interface StubEventLog {
  readonly log: EventLog
  readonly rows: ReadonlyArray<EventRecord>
}

function makeStubEventLog(epoch = 1): StubEventLog {
  const rows: EventRecord[] = []
  let nextSeq = 1
  const log: EventLog = {
    publish(channel: EventChannel, resourceKind: ResourceKind, resourceId: string, payload: unknown): EventRecord {
      const rec: EventRecord = {
        seq: nextSeq++,
        ts: Date.now(),
        epoch,
        channel,
        resourceKind,
        resourceId,
        payload,
      }
      rows.push(rec)
      return rec
    },
    publishBatch(events: ReadonlyArray<PublishBatchInput>): EventRecord[] {
      return events.map((e) => log.publish(e.channel, e.resourceKind, e.resourceId, e.payload))
    },
    // Methods the runtime doesn't call in these tests; throw so a regression
    // flags itself loudly.
    currentEpoch: () => epoch,
    currentSeq: () => nextSeq - 1,
    rowCount: () => rows.length,
  } as unknown as EventLog
  return { log, rows }
}

// --- Stub Connection capturing envelopes -------------------------------------

class CollectingConnection implements Connection {
  readonly connectionId = 'c1'
  readonly clientId = 'client-A'
  readonly sessionId = 'sess-A'
  readonly envelopes: Envelope[] = []
  bufferedAmount(): number {
    return 0
  }
  send(envelope: Envelope): void {
    this.envelopes.push(envelope)
  }
  sendBinary(): void {
    /* unused */
  }
}

function eventsFromEnvelopes(envs: ReadonlyArray<Envelope>): AgentEvent[] {
  return envs
    .filter((e) => e.channel === AGENT_SESSION_EVENT_CHANNEL)
    .map((e) => (e.args[0] as { payload: AgentEventEnvelope }).payload.event)
}

// --- Tests ---------------------------------------------------------------------

describe('AgentRuntime — integration', () => {
  let stub: StubEventLog
  let subs: SubscriptionManager
  let conn: CollectingConnection

  beforeEach(() => {
    stub = makeStubEventLog()
    subs = new SubscriptionManager()
    conn = new CollectingConnection()
    subs.registerConnection(conn)
  })

  async function runFx<A>(fx: Effect.Effect<A>): Promise<A> {
    return Effect.runPromise(fx)
  }

  async function newRuntime() {
    const provider = mockProvider({
      steps: [
        { kind: 'text', text: 'hello world', chunkSize: 5 },
        { kind: 'stopReason', reason: 'end_turn' },
      ],
    })
    return {
      provider,
      runtime: makeAgentRuntime({
        eventLog: stub.log,
        subscriptions: subs,
        providers: [provider],
      }),
    }
  }

  it('create publishes session.started and the event is queryable via subscription', async () => {
    const { runtime } = await newRuntime()
    const sub = subs.subscribe({
      connectionId: conn.connectionId,
      kind: 'agent-session',
      scope: '__pending__',
      requestId: 'r1',
    })
    expect(sub.id).toBeTruthy()

    const result = await runFx(
      runtime.create({
        providerId: 'mock' as ProviderId,
        cwd: '/tmp',
        workspaceId: null,
      }),
    )
    // Session id on session.started row matches the returned id.
    const sessionId = result.sessionId
    const started = stub.rows.find((r) => (r.payload as AgentEventEnvelope).event.kind === 'session.started')
    expect(started).toBeDefined()
    expect(started!.resourceId).toBe(sessionId)
    expect(result.capabilities.protocolVersion).toBe('1.0-mock')
  })

  it('prompt emits turn.started then text.delta (live-only) then text.completed + turn.completed', async () => {
    const { runtime } = await newRuntime()
    const created = await runFx(
      runtime.create({
        providerId: 'mock' as ProviderId,
        cwd: '/tmp',
        workspaceId: null,
      }),
    )
    // Subscribe to the new session so we capture live events.
    subs.subscribe({
      connectionId: conn.connectionId,
      kind: 'agent-session',
      scope: created.sessionId as unknown as string,
      requestId: 'r2',
    })

    const { turnId } = await runFx(
      runtime.prompt({
        sessionId: created.sessionId,
        content: [{ kind: 'text', text: 'hi' }],
      }),
    )
    expect(turnId).toBeTruthy()

    // Wait for the detached turn fiber to run to completion. The mock has no
    // delay so polling for turn.completed is immediate.
    await waitUntil(() => eventsFromEnvelopes(conn.envelopes).some((e) => e.kind === 'turn.completed'), 1000)

    const live = eventsFromEnvelopes(conn.envelopes)
    const kinds = live.map((e) => e.kind)
    // Expected order: turn.started → text.delta × N → text.completed → turn.completed.
    expect(kinds[0]).toBe('turn.started')
    expect(kinds[kinds.length - 1]).toBe('turn.completed')
    expect(kinds.filter((k) => k === 'text.delta').length).toBeGreaterThan(1)
    expect(kinds).toContain('text.completed')

    // Persisted rows: everything except text.delta (live-only).
    const persistedKinds = stub.rows.map((r) => (r.payload as AgentEventEnvelope).event.kind)
    expect(persistedKinds).toContain('turn.started')
    expect(persistedKinds).toContain('text.completed')
    expect(persistedKinds).toContain('turn.completed')
    expect(persistedKinds).not.toContain('text.delta')
    expect(persistedKinds).not.toContain('reasoning.delta')
  })

  it('cancel during an in-flight turn emits turn.cancelled', async () => {
    const provider = mockProvider({
      steps: [
        // Long chunk with delay so cancel can race.
        { kind: 'text', text: 'a'.repeat(200), chunkSize: 5, delayMs: 20 },
        { kind: 'stopReason', reason: 'end_turn' },
      ],
    })
    const runtime = makeAgentRuntime({
      eventLog: stub.log,
      subscriptions: subs,
      providers: [provider],
    })
    const created = await runFx(
      runtime.create({
        providerId: 'mock' as ProviderId,
        cwd: '/tmp',
        workspaceId: null,
      }),
    )
    subs.subscribe({
      connectionId: conn.connectionId,
      kind: 'agent-session',
      scope: created.sessionId as unknown as string,
      requestId: 'r3',
    })

    await runFx(
      runtime.prompt({
        sessionId: created.sessionId,
        content: [{ kind: 'text', text: 'hi' }],
      }),
    )
    // Give the turn a moment to emit at least one delta.
    await sleep(30)
    const res = await runFx(runtime.cancel({ sessionId: created.sessionId }))
    expect(res.cancelled).toBe(true)

    const kinds = eventsFromEnvelopes(conn.envelopes).map((e) => e.kind)
    expect(kinds).toContain('turn.cancelled')
  })

  it('respondPermission resolves the provider Deferred and the session finishes', async () => {
    const provider = mockProvider({
      steps: [
        {
          kind: 'permission',
          request: { kind: 'other', title: 'approve?' },
        },
        { kind: 'text', text: 'done', chunkSize: 100 },
        { kind: 'stopReason', reason: 'end_turn' },
      ],
    })
    const runtime = makeAgentRuntime({
      eventLog: stub.log,
      subscriptions: subs,
      providers: [provider],
    })
    const created = await runFx(
      runtime.create({
        providerId: 'mock' as ProviderId,
        cwd: '/tmp',
        workspaceId: null,
      }),
    )
    subs.subscribe({
      connectionId: conn.connectionId,
      kind: 'agent-session',
      scope: created.sessionId as unknown as string,
      requestId: 'r4',
    })

    await runFx(
      runtime.prompt({
        sessionId: created.sessionId,
        content: [{ kind: 'text', text: 'go' }],
      }),
    )

    // Wait for permission.requested to appear, then answer.
    await waitUntil(() => eventsFromEnvelopes(conn.envelopes).some((e) => e.kind === 'permission.requested'), 1000)
    const requestedEvent = eventsFromEnvelopes(conn.envelopes).find((e) => e.kind === 'permission.requested')
    if (requestedEvent?.kind !== 'permission.requested') throw new Error('unreachable')

    const resp = await runFx(
      runtime.respondPermission({
        sessionId: created.sessionId,
        requestId: requestedEvent.requestId,
        decision: { behaviour: 'allow', scope: 'once' },
      }),
    )
    expect(resp.accepted).toBe(true)

    await waitUntil(() => eventsFromEnvelopes(conn.envelopes).some((e) => e.kind === 'turn.completed'), 1000)
    const kinds = eventsFromEnvelopes(conn.envelopes).map((e) => e.kind)
    expect(kinds).toContain('permission.resolved')
    expect(kinds).toContain('turn.completed')
  })

  it('close emits session.closed and drops the session from the registry', async () => {
    const { runtime } = await newRuntime()
    const created = await runFx(
      runtime.create({
        providerId: 'mock' as ProviderId,
        cwd: '/tmp',
        workspaceId: null,
      }),
    )
    subs.subscribe({
      connectionId: conn.connectionId,
      kind: 'agent-session',
      scope: created.sessionId as unknown as string,
      requestId: 'r5',
    })

    const res = await runFx(runtime.close({ sessionId: created.sessionId }))
    expect(res.closed).toBe(true)

    const kinds = eventsFromEnvelopes(conn.envelopes).map((e) => e.kind)
    expect(kinds).toContain('session.closed')

    // Subsequent operations surface SessionNotFound.
    const caught = await runFx(runtime.get(created.sessionId).pipe(Effect.either))
    expect(caught._tag).toBe('Left')
  })

  it('create with an unknown provider fails fast', async () => {
    const runtime = makeAgentRuntime({
      eventLog: stub.log,
      subscriptions: subs,
      providers: [],
    })
    const outcome = await runFx(
      runtime.create({ providerId: 'ghost' as ProviderId, cwd: '/tmp', workspaceId: null }).pipe(Effect.either),
    )
    expect(outcome._tag).toBe('Left')
    if (outcome._tag !== 'Left') return
    expect(outcome.left._tag).toBe('ProviderNotFound')
  })
})

// --- utils --------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil: timeout')
    await sleep(5)
  }
}
