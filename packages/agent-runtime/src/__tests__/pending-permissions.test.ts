// -----------------------------------------------------------------------------
// agent_pending_permissions lifecycle: insert on permission.requested, resolve
// on respondPermission / turn cancellation, boot-time drain synthesizes deny
// for rows left hanging by a prior process.
// -----------------------------------------------------------------------------

import {
  AGENT_SESSION_EVENT_CHANNEL,
  type AgentEvent,
  type CURRENT_EVENT_SCHEMA_VERSION,
  type PermissionRequest,
  type ProviderId,
  type RequestId,
  type SessionId,
} from '@wanda/agent-protocol'
import type { EventLog, EventRecord, PublishBatchInput } from '@wanda/event-log'
import { SubscriptionManager } from '@wanda/subscriptions'
import type { EventChannel, ResourceKind } from '@wanda/wire'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockProvider } from '../mock-provider.ts'
import { makeInMemoryPendingPermissionsStore, type PendingPermissionsStore } from '../pending-permissions-store.ts'
import { makeAgentRuntime } from '../runtime.ts'
import { makeInMemorySessionStore, type SessionStore } from '../session-store.ts'

type PublishedEvent = {
  channel: EventChannel
  resourceId: string
  payload: { schemaVersion: typeof CURRENT_EVENT_SCHEMA_VERSION; event: AgentEvent }
  seq: number
  ts: number
}

function makeRecordingEventLog(): { log: EventLog; published: PublishedEvent[] } {
  const published: PublishedEvent[] = []
  let seq = 1
  const log = {
    publish(channel: EventChannel, resourceKind: ResourceKind, resourceId: string, payload: unknown): EventRecord {
      const record: EventRecord = {
        seq: seq++,
        ts: Date.now(),
        epoch: 1,
        channel,
        resourceKind,
        resourceId,
        payload,
      }
      published.push({
        channel,
        resourceId,
        payload: payload as PublishedEvent['payload'],
        seq: record.seq,
        ts: record.ts,
      })
      return record
    },
    publishBatch(events: ReadonlyArray<PublishBatchInput>): EventRecord[] {
      return events.map((e) => log.publish(e.channel, e.resourceKind, e.resourceId, e.payload))
    },
  } as unknown as EventLog
  return { log, published }
}

const toolRequest: PermissionRequest = {
  kind: 'tool',
  toolCallId: 'tc_test' as unknown as PermissionRequest extends { toolCallId: infer T } ? T : never,
  title: 'rm -rf /',
  detail: { kind: 'other' },
}

describe('AgentRuntime — pending permissions', () => {
  let recorded: ReturnType<typeof makeRecordingEventLog>
  let subs: SubscriptionManager
  let sessionStore: SessionStore
  let pendingPermissions: PendingPermissionsStore

  beforeEach(() => {
    recorded = makeRecordingEventLog()
    subs = new SubscriptionManager()
    sessionStore = makeInMemorySessionStore()
    pendingPermissions = makeInMemoryPendingPermissionsStore()
  })

  async function pumpMicrotasks(): Promise<void> {
    await new Promise((r) => setTimeout(r, 30))
  }

  it('inserts a row when awaitPermission emits permission.requested', async () => {
    const provider = mockProvider({
      steps: [
        { kind: 'permission', request: toolRequest },
        { kind: 'stopReason', reason: 'end_turn' },
      ],
    })
    const runtime = makeAgentRuntime({
      eventLog: recorded.log,
      subscriptions: subs,
      providers: [provider],
      sessionStore,
      pendingPermissions,
    })
    const { sessionId } = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/tmp', workspaceId: null }),
    )
    await Effect.runPromise(runtime.prompt({ sessionId, content: [{ kind: 'text', text: 'trigger' }] }))
    await pumpMicrotasks()

    const outstanding = pendingPermissions.listUnresolved()
    expect(outstanding).toHaveLength(1)
    expect(outstanding[0]?.sessionId).toBe(sessionId)
    expect(outstanding[0]?.request.kind).toBe('tool')
    expect(outstanding[0]?.eventSeq).toBeGreaterThan(0)

    // Cleanup: cancel so the pending Deferred doesn't leak past the test.
    await Effect.runPromise(runtime.cancel({ sessionId }))
  })

  it('marks the row resolved when respondPermission lands', async () => {
    const provider = mockProvider({
      steps: [
        { kind: 'permission', request: toolRequest },
        { kind: 'stopReason', reason: 'end_turn' },
      ],
    })
    const runtime = makeAgentRuntime({
      eventLog: recorded.log,
      subscriptions: subs,
      providers: [provider],
      sessionStore,
      pendingPermissions,
    })
    const { sessionId } = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/tmp', workspaceId: null }),
    )
    await Effect.runPromise(runtime.prompt({ sessionId, content: [{ kind: 'text', text: 'trigger' }] }))
    await pumpMicrotasks()

    const [pending] = pendingPermissions.listUnresolved()
    expect(pending).toBeDefined()
    if (!pending) return

    await Effect.runPromise(
      runtime.respondPermission({
        sessionId,
        requestId: pending.requestId,
        decision: { behaviour: 'allow', scope: 'once' },
      }),
    )
    await pumpMicrotasks()

    expect(pendingPermissions.listUnresolved()).toHaveLength(0)
  })

  it('drains outstanding pendings when a turn is cancelled', async () => {
    const provider = mockProvider({
      steps: [
        { kind: 'permission', request: toolRequest },
        { kind: 'stopReason', reason: 'end_turn' },
      ],
    })
    const runtime = makeAgentRuntime({
      eventLog: recorded.log,
      subscriptions: subs,
      providers: [provider],
      sessionStore,
      pendingPermissions,
    })
    const { sessionId } = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/tmp', workspaceId: null }),
    )
    await Effect.runPromise(runtime.prompt({ sessionId, content: [{ kind: 'text', text: 'trigger' }] }))
    await pumpMicrotasks()
    expect(pendingPermissions.listUnresolved()).toHaveLength(1)

    await Effect.runPromise(runtime.cancel({ sessionId }))
    await pumpMicrotasks()

    expect(pendingPermissions.listUnresolved()).toHaveLength(0)
  })

  it('drainPendingPermissions emits permission.resolved + marks rows resolved', async () => {
    // Seed the store directly to simulate rows left by a prior process. No
    // live session is needed — the drain operates purely on store contents.
    const sessionId = 'ses_stale' as unknown as SessionId
    pendingPermissions.insert({
      requestId: 'req_one' as unknown as RequestId,
      sessionId,
      turnId: 'tur_one' as unknown as Parameters<typeof pendingPermissions.insert>[0]['turnId'],
      eventSeq: 42,
      request: toolRequest,
    })
    pendingPermissions.insert({
      requestId: 'req_two' as unknown as RequestId,
      sessionId,
      turnId: 'tur_one' as unknown as Parameters<typeof pendingPermissions.insert>[0]['turnId'],
      eventSeq: 43,
      request: { ...toolRequest, title: 'rm -rf $HOME' },
    })

    const provider = mockProvider()
    const runtime = makeAgentRuntime({
      eventLog: recorded.log,
      subscriptions: subs,
      providers: [provider],
      sessionStore,
      pendingPermissions,
    })

    const drained = await Effect.runPromise(runtime.drainPendingPermissions())
    expect(drained).toBe(2)
    expect(pendingPermissions.listUnresolved()).toHaveLength(0)

    // Two `permission.resolved` events should have hit the event log, one
    // per drained row. Ordering isn't guaranteed, so match on requestId.
    const resolved = recorded.published.filter(
      (p) => p.channel === AGENT_SESSION_EVENT_CHANNEL && p.payload.event.kind === 'permission.resolved',
    )
    expect(resolved).toHaveLength(2)
    const requestIds = resolved.map((r) =>
      r.payload.event.kind === 'permission.resolved' ? r.payload.event.requestId : null,
    )
    expect(requestIds.sort()).toEqual(['req_one', 'req_two'])
    for (const r of resolved) {
      if (r.payload.event.kind !== 'permission.resolved') continue
      expect(r.payload.event.decision.behaviour).toBe('deny')
    }
  })

  it('drainPendingPermissions is a no-op when no store is configured', async () => {
    const runtime = makeAgentRuntime({
      eventLog: recorded.log,
      subscriptions: subs,
      providers: [mockProvider()],
      sessionStore,
      // no pendingPermissions
    })
    const drained = await Effect.runPromise(runtime.drainPendingPermissions())
    expect(drained).toBe(0)
  })

  it('resolve is idempotent — late resolve after drain does not revert the synthetic deny', async () => {
    const sessionId = 'ses_stale' as unknown as SessionId
    pendingPermissions.insert({
      requestId: 'req_one' as unknown as RequestId,
      sessionId,
      turnId: 'tur_one' as unknown as Parameters<typeof pendingPermissions.insert>[0]['turnId'],
      eventSeq: 1,
      request: toolRequest,
    })

    const runtime = makeAgentRuntime({
      eventLog: recorded.log,
      subscriptions: subs,
      providers: [mockProvider()],
      sessionStore,
      pendingPermissions,
    })
    await Effect.runPromise(runtime.drainPendingPermissions())

    // Late resolve from, say, a turn-runner promise that woke up after
    // drain already ran. Must NOT overwrite the synthetic deny.
    pendingPermissions.resolve('req_one' as unknown as RequestId, { behaviour: 'allow', scope: 'once' })
    expect(pendingPermissions.listUnresolved()).toHaveLength(0)
  })
})
