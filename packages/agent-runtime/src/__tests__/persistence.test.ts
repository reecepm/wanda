// -----------------------------------------------------------------------------
// Persistence + resume: writing to the SessionStore on create/close; hitting
// the resume path on a cold `get` that has a durable row but no in-memory
// session.
// -----------------------------------------------------------------------------

import type { AgentProvider, ProviderId } from '@wanda/agent-protocol'
import type { EventLog, EventRecord, PublishBatchInput } from '@wanda/event-log'
import { SubscriptionManager } from '@wanda/subscriptions'
import type { EventChannel, ResourceKind } from '@wanda/wire'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockProvider } from '../mock-provider.ts'
import { makeAgentRuntime } from '../runtime.ts'
import { makeInMemorySessionStore, type SessionStore } from '../session-store.ts'

function makeStubEventLog(): EventLog {
  let seq = 1
  return {
    publish(channel: EventChannel, resourceKind: ResourceKind, resourceId: string, payload: unknown): EventRecord {
      return {
        seq: seq++,
        ts: Date.now(),
        epoch: 1,
        channel,
        resourceKind,
        resourceId,
        payload,
      }
    },
    publishBatch(events: ReadonlyArray<PublishBatchInput>): EventRecord[] {
      return events.map((e) => this.publish(e.channel, e.resourceKind, e.resourceId, e.payload))
    },
  } as unknown as EventLog
}

describe('AgentRuntime — persistence + resume', () => {
  let eventLog: EventLog
  let subs: SubscriptionManager
  let store: SessionStore

  beforeEach(() => {
    eventLog = makeStubEventLog()
    subs = new SubscriptionManager()
    store = makeInMemorySessionStore()
  })

  it('create inserts a row into the session store', async () => {
    const provider = mockProvider()
    const runtime = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    const { sessionId } = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/tmp', workspaceId: null }),
    )
    const row = store.findById(sessionId)
    expect(row).not.toBeNull()
    expect(row?.providerId).toBe('mock')
    expect(row?.cwd).toBe('/tmp')
  })

  it('close marks the row as closed', async () => {
    const provider = mockProvider()
    const runtime = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    const { sessionId } = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/tmp', workspaceId: null }),
    )
    await Effect.runPromise(runtime.close({ sessionId }))
    expect(store.findById(sessionId)?.state).toBe('closed')
  })

  it('get rehydrates via provider.resume when only the store has the session', async () => {
    // Ship an already-persisted row to a fresh runtime and make sure the
    // provider's `resume` is what gets called (not `spawn`).
    const resumeSpy = vi.fn<AgentProvider['resume']>()
    const spawnSpy = vi.fn<AgentProvider['spawn']>()
    const base = mockProvider()
    const provider: AgentProvider = {
      ...base,
      spawn: (ctx) => {
        spawnSpy(ctx)
        return base.spawn(ctx)
      },
      resume: (ctx) => {
        resumeSpy(ctx)
        return base.resume!(ctx)
      },
    }
    const runtime = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    // Create through the runtime so the mock provider's spawn builds a valid
    // AgentSession; the store gets a real row.
    const { sessionId } = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/tmp', workspaceId: null }),
    )
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    resumeSpy.mockClear()
    spawnSpy.mockClear()

    // Simulate "restart": make a fresh runtime that doesn't know about the
    // in-memory session. Pass the same store.
    const restarted = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    const detail = await Effect.runPromise(restarted.get(sessionId))
    expect(detail.sessionId).toBe(sessionId)
    expect(resumeSpy).toHaveBeenCalledTimes(1)
    expect(spawnSpy).toHaveBeenCalledTimes(0)
  })

  it('get fails with SessionClosed when the row is archived-closed', async () => {
    const provider = mockProvider()
    const runtime = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    const { sessionId } = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/tmp', workspaceId: null }),
    )
    await Effect.runPromise(runtime.close({ sessionId }))

    // Fresh runtime: closed session should refuse resume.
    const restarted = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    const outcome = await Effect.runPromise(restarted.get(sessionId).pipe(Effect.either))
    expect(outcome._tag).toBe('Left')
    if (outcome._tag !== 'Left') return
    expect(outcome.left._tag).toBe('SessionClosed')
  })

  it('get without a store still surfaces SessionNotFound for unknown ids', async () => {
    const provider = mockProvider()
    const runtime = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
    })
    const outcome = await Effect.runPromise(
      runtime.get('ses_never_created' as unknown as Parameters<typeof runtime.get>[0]).pipe(Effect.either),
    )
    expect(outcome._tag).toBe('Left')
    if (outcome._tag !== 'Left') return
    expect(outcome.left._tag).toBe('SessionNotFound')
  })

  it('provider without resume falls back to spawn on rehydrate', async () => {
    const spawnSpy = vi.fn<AgentProvider['spawn']>()
    const base = mockProvider()
    const provider: AgentProvider = {
      ...base,
      manifest: {
        ...base.manifest,
        staticCapabilities: { ...base.manifest.staticCapabilities, supportsSessionResume: false },
      },
      spawn: (ctx) => {
        spawnSpy(ctx)
        return base.spawn(ctx)
      },
      resume: undefined,
    }
    const runtime = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    const { sessionId } = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/tmp', workspaceId: null }),
    )
    spawnSpy.mockClear()

    const restarted = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    await Effect.runPromise(restarted.get(sessionId))
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    // Resume context should include the stored handle so the provider can
    // decide whether to honour it.
    expect(spawnSpy.mock.calls[0]?.[0].resumeHandle).toBeDefined()
  })

  it('listPersisted returns DB rows with resident flag marking in-memory sessions', async () => {
    const provider = mockProvider()
    const runtime = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    const first = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/a', workspaceId: 'ws1' }),
    )
    const second = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/b', workspaceId: 'ws2' }),
    )

    const all = await Effect.runPromise(runtime.listPersisted())
    expect(all.map((r) => r.sessionId).sort()).toEqual([first.sessionId, second.sessionId].sort())
    expect(all.every((r) => r.resident)).toBe(true)

    const ws1Only = await Effect.runPromise(runtime.listPersisted({ workspaceId: 'ws1' }))
    expect(ws1Only).toHaveLength(1)
    expect(ws1Only[0]?.sessionId).toBe(first.sessionId)

    // Archived sessions hidden by default, shown when asked.
    await Effect.runPromise(runtime.archive(first.sessionId))
    const visible = await Effect.runPromise(runtime.listPersisted())
    expect(visible.map((r) => r.sessionId)).toEqual([second.sessionId])
    const withArchived = await Effect.runPromise(runtime.listPersisted({ includeArchived: true }))
    expect(withArchived).toHaveLength(2)
  })

  it('first prompt auto-titles the session and fanout bumps lastEventAt', async () => {
    const provider = mockProvider({
      steps: [
        { kind: 'text', text: 'hi back', chunkSize: 100 },
        { kind: 'stopReason', reason: 'end_turn' },
      ],
    })
    const runtime = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    const { sessionId } = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/tmp', workspaceId: null }),
    )
    const beforeAt = store.findById(sessionId)?.lastEventAt
    // session.started fires on create via fanout → lastEventAt is already set.
    expect(beforeAt).toBeGreaterThan(0)
    expect(store.findById(sessionId)?.title).toBeNull()

    await Effect.runPromise(
      runtime.prompt({
        sessionId,
        content: [{ kind: 'text', text: 'Explain Redux in a sentence' }],
      }),
    )
    await new Promise((r) => setTimeout(r, 60))
    const after = store.findById(sessionId)
    expect(after?.title).toBe('Explain Redux in a sentence')
    expect(after?.titleSource).toBe('auto')
    expect(after?.lastEventAt).toBeGreaterThanOrEqual(beforeAt ?? 0)
    expect(after?.lastEventSeq).toBeGreaterThan(0)
  })

  it('rename overwrites auto-title and locks it from auto-overwrites', async () => {
    const provider = mockProvider()
    const runtime = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    const { sessionId } = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/tmp', workspaceId: null }),
    )
    // Seed an auto-title through a prompt so we can prove user overrides it.
    await Effect.runPromise(runtime.prompt({ sessionId, content: [{ kind: 'text', text: 'auto title here' }] }))
    await new Promise((r) => setTimeout(r, 40))
    expect(store.findById(sessionId)?.title).toBe('auto title here')

    await Effect.runPromise(runtime.rename(sessionId, 'My Session'))
    expect(store.findById(sessionId)?.title).toBe('My Session')
    expect(store.findById(sessionId)?.titleSource).toBe('user')

    // Subsequent auto-title attempt is a no-op.
    store.updateTitle(sessionId, 'should be ignored', 'auto')
    expect(store.findById(sessionId)?.title).toBe('My Session')
  })

  it('listPersisted orders by lastEventAt DESC', async () => {
    const provider = mockProvider()
    const runtime = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    const a = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/a', workspaceId: null }),
    )
    await new Promise((r) => setTimeout(r, 5))
    const b = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/b', workspaceId: null }),
    )
    // Touch `a` to make it more recent.
    await new Promise((r) => setTimeout(r, 5))
    await Effect.runPromise(runtime.prompt({ sessionId: a.sessionId, content: [{ kind: 'text', text: 'touch' }] }))
    await new Promise((r) => setTimeout(r, 60))
    const list = await Effect.runPromise(runtime.listPersisted())
    expect(list[0]?.sessionId).toBe(a.sessionId)
    expect(list[1]?.sessionId).toBe(b.sessionId)
  })

  it('archive fails with SessionNotFound for unknown ids', async () => {
    const provider = mockProvider()
    const runtime = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    const outcome = await Effect.runPromise(
      runtime.archive('ses_ghost' as unknown as Parameters<typeof runtime.archive>[0]).pipe(Effect.either),
    )
    expect(outcome._tag).toBe('Left')
    if (outcome._tag !== 'Left') return
    expect(outcome.left._tag).toBe('SessionNotFound')
  })

  it('turn completion flushes snapshotHandle into the store', async () => {
    // Stand up a provider whose snapshotHandle returns a sentinel we can
    // detect post-turn. The mock provider already supplies a mock handle
    // at spawn time; we extend it with a mutable counter.
    const base = mockProvider({
      steps: [
        { kind: 'text', text: 'ok' },
        { kind: 'stopReason', reason: 'end_turn' },
      ],
    })
    let turnCount = 0
    const provider: AgentProvider = {
      ...base,
      spawn: (ctx) =>
        base.spawn(ctx).pipe(
          Effect.map((session) => ({
            ...session,
            snapshotHandle: () => ({
              variant: 'mock-v2',
              turnCount: ++turnCount,
            }),
          })),
        ),
    }
    const runtime = makeAgentRuntime({
      eventLog,
      subscriptions: subs,
      providers: [provider],
      sessionStore: store,
    })
    const { sessionId } = await Effect.runPromise(
      runtime.create({ providerId: 'mock' as ProviderId, cwd: '/tmp', workspaceId: null }),
    )
    await Effect.runPromise(runtime.prompt({ sessionId, content: [{ kind: 'text', text: 'hi' }] }))
    // Give the forked turn fiber a moment to run to completion.
    await new Promise((r) => setTimeout(r, 50))
    const row = store.findById(sessionId)
    expect(row?.persistenceHandle?.variant).toBe('mock-v2')
    expect((row?.persistenceHandle as { turnCount?: number } | null)?.turnCount).toBeGreaterThanOrEqual(1)
  })
})
