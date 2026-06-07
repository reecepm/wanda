// -----------------------------------------------------------------------------
// ManagedSession — per-session state container.
//
// Holds the SessionState Ref, pending Deferred maps for permissions /
// questions, the scope that owns the provider subprocess, and
// last-active-at. Deliberately mutable (Refs) so the turn runner can keep
// short hot-path operations cheap.
// -----------------------------------------------------------------------------

import type {
  Decision,
  ModeId,
  ModelId,
  QuestionAnswer,
  QuestionId,
  ReasoningEffort,
  RequestId,
  SessionId,
  TurnId,
} from '@wanda/agent-protocol'
import type * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import type * as Fiber from 'effect/Fiber'
import * as Ref from 'effect/Ref'
import type * as Scope from 'effect/Scope'
import type { SessionState } from './state-machine.ts'
import type { AgentSession, PersistenceHandle } from './types.ts'

/** Present only while a turn fiber is running. */
export interface ActiveTurn {
  readonly turnId: TurnId
  readonly fiber: Fiber.RuntimeFiber<void, never>
  readonly abort: AbortController
  readonly startedAt: number
}

export interface ManagedSession {
  readonly sessionId: SessionId
  readonly providerId: string
  readonly cwd: string
  readonly workspaceId: string | null
  /** Alive only while state !== 'cold' | 'closed'. */
  readonly session: AgentSession
  readonly state: Ref.Ref<SessionState>
  readonly scope: Scope.CloseableScope
  readonly pending: Ref.Ref<ReadonlyMap<RequestId, Deferred.Deferred<Decision>>>
  readonly questions: Ref.Ref<ReadonlyMap<QuestionId, Deferred.Deferred<QuestionAnswer>>>
  readonly lastActiveAt: Ref.Ref<number>
  readonly persistenceHandle: Ref.Ref<PersistenceHandle>
  readonly modeId: Ref.Ref<ModeId | null>
  readonly modelId: Ref.Ref<ModelId | null>
  readonly reasoningEffort: Ref.Ref<ReasoningEffort | null>
  /** Populated while the turn fiber is running; null between turns. */
  readonly activeTurn: Ref.Ref<ActiveTurn | null>
}

export interface MakeManagedSessionInput {
  readonly sessionId: SessionId
  readonly providerId: string
  readonly cwd: string
  readonly workspaceId: string | null
  readonly session: AgentSession
  readonly scope: Scope.CloseableScope
  readonly now?: () => number
}

/**
 * Build a `ManagedSession` initialised at state `ready`. The caller owns the
 * `scope` and is responsible for closing it on evict / close.
 */
export function makeManagedSession(input: MakeManagedSessionInput): Effect.Effect<ManagedSession> {
  return Effect.gen(function* () {
    const now = (input.now ?? Date.now)()
    const state = yield* Ref.make<SessionState>({ tag: 'ready', readySince: now })
    const pending = yield* Ref.make<ReadonlyMap<RequestId, Deferred.Deferred<Decision>>>(new Map())
    const questions = yield* Ref.make<ReadonlyMap<QuestionId, Deferred.Deferred<QuestionAnswer>>>(new Map())
    const lastActiveAt = yield* Ref.make(now)
    const persistenceHandle = yield* Ref.make(input.session.persistenceHandle)
    const modeId = yield* Ref.make(input.session.currentModeId)
    const modelId = yield* Ref.make(input.session.currentModelId)
    const reasoningEffort = yield* Ref.make(input.session.currentReasoningEffort)
    const activeTurn = yield* Ref.make<ActiveTurn | null>(null)
    return {
      sessionId: input.sessionId,
      providerId: input.providerId,
      cwd: input.cwd,
      workspaceId: input.workspaceId,
      session: input.session,
      state,
      scope: input.scope,
      pending,
      questions,
      lastActiveAt,
      persistenceHandle,
      modeId,
      modelId,
      reasoningEffort,
      activeTurn,
    }
  })
}

/** Touch `lastActiveAt`. Used by registry.get() and on every emit. */
export function touch(managed: ManagedSession, at?: number): Effect.Effect<void> {
  return Ref.set(managed.lastActiveAt, at ?? Date.now())
}
