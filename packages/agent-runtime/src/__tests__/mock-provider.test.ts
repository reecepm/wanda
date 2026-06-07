// -----------------------------------------------------------------------------
// Mock provider behaviour. Drives scripted steps through a hand-built
// `TurnContext` and asserts on the emitted event stream.
// -----------------------------------------------------------------------------

import {
  type AgentEvent,
  type Decision,
  newSessionId,
  newTurnId,
  type PermissionRequest,
  type QuestionAnswer,
} from '@wanda/agent-protocol'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { mockProvider } from '../mock-provider.ts'
import type { TurnContext } from '../types.ts'

function makeCtx(overrides?: Partial<TurnContext>): {
  ctx: TurnContext
  emitted: AgentEvent[]
  abort: AbortController
} {
  const emitted: AgentEvent[] = []
  const abort = new AbortController()
  const ctx: TurnContext = {
    sessionId: newSessionId(),
    turnId: newTurnId(),
    emit: (e) => emitted.push(e),
    awaitPermission: (_req: PermissionRequest) => Promise.resolve<Decision>({ behaviour: 'allow', scope: 'once' }),
    awaitQuestion: () => Promise.resolve<QuestionAnswer>({ kind: 'freeform', text: 'ok' }),
    signal: abort.signal,
    ...overrides,
  }
  return { ctx, emitted, abort }
}

describe('mockProvider', () => {
  it('spawns with defaults and detects as available', async () => {
    const provider = mockProvider()
    const detect = await Effect.runPromise(
      provider.detect({
        platform: 'node',
        isSubprocess: false,
        cwd: '/tmp',
        env: {},
        userDataDir: '/tmp',
      }),
    )
    expect(detect.available).toBe(true)
    expect(detect.version).toBe('0.0.0-mock')
  })

  it('runs a scripted text step and ends the turn', async () => {
    const provider = mockProvider({
      steps: [
        { kind: 'text', text: 'hello world', chunkSize: 5 },
        { kind: 'stopReason', reason: 'end_turn' },
      ],
    })
    const session = await Effect.runPromise(
      Effect.scoped(
        provider.spawn({
          sessionId: newSessionId(),
          cwd: '/tmp',
          env: {},
          workspaceId: null,
        }),
      ),
    )
    const { ctx, emitted } = makeCtx()
    const result = await Effect.runPromise(session.prompt(ctx, [{ kind: 'text', text: 'hi' }]))
    expect(result.stopReason).toBe('end_turn')

    const deltas = emitted.filter((e) => e.kind === 'text.delta')
    const completed = emitted.find((e) => e.kind === 'text.completed')
    expect(deltas.length).toBeGreaterThan(1)
    expect(completed).toBeDefined()
    if (completed?.kind !== 'text.completed') throw new Error('unreachable')
    expect(completed.text).toBe('hello world')
    // Deltas carry strictly-increasing index.
    const indices = deltas
      .filter((e): e is Extract<AgentEvent, { kind: 'text.delta' }> => e.kind === 'text.delta')
      .map((e) => e.index)
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
  })

  it('delegates a permission step to the TurnContext awaitPermission bridge', async () => {
    const request: PermissionRequest = {
      kind: 'other',
      title: 'can I?',
      description: 'some risky thing',
    }
    const provider = mockProvider({
      steps: [
        { kind: 'permission', request, timeoutMs: 1000 },
        { kind: 'stopReason', reason: 'end_turn' },
      ],
    })
    const session = await Effect.runPromise(
      Effect.scoped(provider.spawn({ sessionId: newSessionId(), cwd: '/tmp', env: {}, workspaceId: null })),
    )
    // Capture what the mock hands to awaitPermission. The mock no longer
    // emits permission.requested / permission.resolved directly — that is
    // the runtime bridge's job (09 §7.3). This test verifies the delegation.
    let seen: PermissionRequest | undefined
    const { ctx } = makeCtx({
      awaitPermission: async (req) => {
        seen = req
        return { behaviour: 'deny', scope: 'once', message: 'nope' } as Decision
      },
    })
    const result = await Effect.runPromise(session.prompt(ctx, [{ kind: 'text', text: 'go' }]))
    expect(result.stopReason).toBe('end_turn')
    expect(seen).toMatchObject({ kind: 'other', title: 'can I?' })
  })

  it('emits a tool lifecycle with completed status', async () => {
    const provider = mockProvider({
      steps: [
        { kind: 'tool', toolKind: 'execute', title: 'bun test', outcome: 'completed' },
        { kind: 'stopReason', reason: 'end_turn' },
      ],
    })
    const session = await Effect.runPromise(
      Effect.scoped(provider.spawn({ sessionId: newSessionId(), cwd: '/tmp', env: {}, workspaceId: null })),
    )
    const { ctx, emitted } = makeCtx()
    await Effect.runPromise(session.prompt(ctx, [{ kind: 'text', text: 'go' }]))
    expect(emitted.find((e) => e.kind === 'tool.started')).toBeDefined()
    const done = emitted.find((e) => e.kind === 'tool.completed')
    expect(done).toBeDefined()
    if (done?.kind !== 'tool.completed') throw new Error('unreachable')
    expect(done.status).toBe('completed')
  })

  it('stops early when the abort signal fires between steps', async () => {
    const provider = mockProvider({
      steps: [
        { kind: 'text', text: 'a' },
        { kind: 'text', text: 'b' },
        { kind: 'stopReason', reason: 'end_turn' },
      ],
    })
    const session = await Effect.runPromise(
      Effect.scoped(provider.spawn({ sessionId: newSessionId(), cwd: '/tmp', env: {}, workspaceId: null })),
    )
    const { ctx, abort } = makeCtx()
    abort.abort()
    const result = await Effect.runPromise(session.prompt(ctx, [{ kind: 'text', text: 'go' }]))
    expect(result.stopReason).toBe('cancelled')
  })

  it('resume returns an equivalent AgentSession', async () => {
    const provider = mockProvider()
    expect(provider.resume).toBeDefined()
    const session = await Effect.runPromise(
      Effect.scoped(
        provider.resume!({
          sessionId: newSessionId(),
          cwd: '/tmp',
          env: {},
          workspaceId: null,
          resumeHandle: { variant: 'mock', handle: 'x' },
        }),
      ),
    )
    expect(session.capabilities.protocolVersion).toBe('1.0-mock')
    expect(session.persistenceHandle.variant).toBe('mock')
  })
})
