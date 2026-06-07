// -----------------------------------------------------------------------------
// Turn runner — drives one `provider.prompt()` call end-to-end.
//
// Allocates a TurnContext whose `emit` / `awaitPermission` / `awaitQuestion`
// bridges plug back into the ManagedSession. Handles cancellation by
// interrupting the fiber; `Effect.ensuring` runs the cleanup pass
// (turn.cancelled emission, pending drain, transition back to ready).
// -----------------------------------------------------------------------------

import {
  type Decision,
  newQuestionId,
  newRequestId,
  type PermissionRequest,
  type PromptBlock,
  type QuestionAnswer,
  type QuestionId,
  type QuestionOption,
  type RequestId,
  type ReviewTarget,
  type TurnId,
} from '@wanda/agent-protocol'
import * as Cause from 'effect/Cause'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { pipe } from 'effect/Function'
import * as Ref from 'effect/Ref'
import { AgentProviderError } from './errors.ts'
import type { EventFanout } from './event-fanout.ts'
import type { ManagedSession } from './managed-session.ts'
import type { PendingPermissionsStore } from './pending-permissions-store.ts'
import type { PermissionPolicyStore } from './permission-policy-store.ts'
import type { SessionStore } from './session-store.ts'
import type { TurnContext } from './types.ts'

/**
 * What kicks this turn off. A regular `prompt` turn runs
 * `session.prompt(ctx, content)`; a `review` turn runs
 * `session.startReview(ctx, target)`. Both drive the same TurnContext
 * machinery downstream — the discriminator only affects how the body
 * gets started.
 */
export type TurnBody =
  | { readonly kind: 'prompt'; readonly content: ReadonlyArray<PromptBlock> }
  | { readonly kind: 'review'; readonly target: ReviewTarget }

export interface RunTurnInput {
  readonly managed: ManagedSession
  readonly turnId: TurnId
  readonly body: TurnBody
  readonly abort: AbortController
  readonly fanout: EventFanout
  readonly now?: () => number
  /** Optional persistence flush after success / interrupt. */
  readonly store?: SessionStore
  /** Optional durable mirror for outstanding permission prompts. */
  readonly pendingPermissions?: PendingPermissionsStore
  /** Optional persisted `scope: "always"` policy resolver. */
  readonly permissionPolicies?: PermissionPolicyStore
  /** Optional logger for persistence failures. */
  readonly logger?: (message: string, ctx?: unknown) => void
}

/**
 * Wire a ManagedSession + turnId into a TurnContext and drive `prompt()`.
 * On success: emits `turn.completed`, transitions state `running → ready`.
 * On failure: emits `error` + `turn.cancelled`, transitions `running → error`.
 * On interrupt: emits `turn.cancelled { acknowledged: false }`, transitions
 * `running → ready`.
 *
 * Caller forks this with `Effect.fork` and stores the fiber on state.running.
 */
export function runTurn(input: RunTurnInput): Effect.Effect<void> {
  const { managed, turnId, body: spec, abort, fanout, store, pendingPermissions, permissionPolicies, logger } = input
  const now = input.now ?? Date.now

  const ctx = buildTurnContext({ managed, turnId, abort, fanout, pendingPermissions, permissionPolicies, logger })

  const flushHandle = (): void => {
    if (!store) return
    try {
      const handle = managed.session.snapshotHandle?.() ?? managed.session.persistenceHandle
      store.updatePersistenceHandle(managed.sessionId, handle)
    } catch (err) {
      logger?.('sessionStore.updatePersistenceHandle failed', { sessionId: managed.sessionId, err })
    }
  }

  const drainPending = Effect.gen(function* () {
    // Resolve any still-outstanding permission/question Deferreds so the
    // provider promise bridges return. Uses a conservative default decision.
    const perms = yield* Ref.get(managed.pending)
    const decision: Decision = {
      behaviour: 'deny',
      scope: 'once',
      message: 'turn cancelled',
    }
    for (const [requestId, def] of perms) {
      yield* Deferred.succeed(def, decision)
      if (pendingPermissions) {
        try {
          pendingPermissions.resolve(requestId, decision)
        } catch (err) {
          logger?.('pendingPermissions.resolve (drain) failed', { requestId, err })
        }
      }
    }
    yield* Ref.set(managed.pending, new Map())
    const questions = yield* Ref.get(managed.questions)
    for (const def of questions.values()) {
      const cancelled: QuestionAnswer = { kind: 'freeform', text: '' }
      yield* Deferred.succeed(def, cancelled)
    }
    yield* Ref.set(managed.questions, new Map())
  })

  const body =
    spec.kind === 'prompt'
      ? managed.session.prompt(ctx, spec.content)
      : (() => {
          // Review turns require an opt-in session method. Sessions without
          // `startReview` advertised `supportsReview: false`; the router
          // should've rejected the call before we got here.
          const startReview = managed.session.startReview
          if (!startReview) {
            return Effect.fail(
              new AgentProviderError({
                providerId: managed.providerId as import('@wanda/agent-protocol').ProviderId,
                phase: 'prompt',
                message: 'provider does not support startReview',
                recoverable: false,
              }),
            )
          }
          return startReview(ctx, spec.target)
        })()

  const onSuccess = (result: { stopReason: import('@wanda/agent-protocol').StopReason }) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        fanout.emit(managed.sessionId, {
          kind: 'turn.completed',
          sessionId: managed.sessionId,
          turnId,
          stopReason: result.stopReason,
        })
        yield* Ref.set(managed.state, { tag: 'ready', readySince: now() })
        yield* Ref.set(managed.lastActiveAt, now())
        flushHandle()
      }),
    )

  const onFailure = (cause: Cause.Cause<unknown>) =>
    Effect.gen(function* () {
      if (Cause.isInterruptedOnly(cause)) {
        fanout.emit(managed.sessionId, {
          kind: 'turn.cancelled',
          sessionId: managed.sessionId,
          turnId,
          acknowledged: false,
        })
        yield* drainPending
        yield* Ref.set(managed.state, { tag: 'ready', readySince: now() })
        flushHandle()
        return
      }
      const message = Cause.pretty(cause)
      const stderrTail = managed.session.stderrSnapshot().slice(-4096)
      // Fish the provider's recoverability flag out of the cause if the
      // failure was an AgentProviderError. Transport/spawn failures flag
      // themselves non-recoverable so the runtime can evict + respawn on
      // next prompt instead of looping through a dead channel.
      const recoverable = extractRecoverable(cause)
      fanout.emit(managed.sessionId, {
        kind: 'error',
        sessionId: managed.sessionId,
        turnId,
        message,
        recoverable,
        stderrTail: stderrTail || undefined,
      })
      fanout.emit(managed.sessionId, {
        kind: 'turn.cancelled',
        sessionId: managed.sessionId,
        turnId,
        acknowledged: false,
      })
      yield* drainPending
      yield* Ref.set(managed.state, {
        tag: 'error',
        at: now(),
        message,
        recoverable,
        stderrTail: stderrTail || undefined,
      })
    })

  // `Effect.onExit` is always uninterruptible for its handler, so the
  // turn.completed / turn.cancelled / error emissions run even when the
  // fiber is being interrupted. Without this, a second interrupt could
  // pre-empt the handler and leave the session stuck in 'running'.
  return pipe(
    body,
    Effect.onExit((exit) =>
      Exit.match(exit, {
        onSuccess: (result) => onSuccess(result),
        onFailure: (cause) => onFailure(cause),
      }),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        if (!abort.signal.aborted) abort.abort()
      }),
    ),
    Effect.catchAllCause((cause) => {
      // eslint-disable-next-line no-console
      console.error('[agent-runtime] turn finaliser threw', Cause.pretty(cause))
      return Effect.void
    }),
  )
}

/**
 * Walk a Cause for an AgentProviderError and return its `recoverable` flag.
 * Defaults to `true` so unknown/defect failures don't trap the session in a
 * non-recoverable error state without explicit provider intent.
 */
function extractRecoverable(cause: Cause.Cause<unknown>): boolean {
  for (const failure of Cause.failures(cause)) {
    if (failure instanceof AgentProviderError) return failure.recoverable
  }
  return true
}

function buildTurnContext(input: {
  managed: ManagedSession
  turnId: TurnId
  abort: AbortController
  fanout: EventFanout
  pendingPermissions?: PendingPermissionsStore
  permissionPolicies?: PermissionPolicyStore
  logger?: (message: string, ctx?: unknown) => void
}): TurnContext {
  const { managed, turnId, abort, fanout, pendingPermissions, permissionPolicies, logger } = input

  const awaitPermission = async (request: PermissionRequest, timeoutMs?: number): Promise<Decision> => {
    if (permissionPolicies) {
      try {
        const saved = permissionPolicies.resolve({
          sessionId: managed.sessionId,
          providerId: managed.providerId,
          workspaceId: managed.workspaceId,
          cwd: managed.cwd,
          request,
        })
        if (saved) return saved
      } catch (err) {
        logger?.('permissionPolicies.resolve failed', { sessionId: managed.sessionId, err })
      }
    }

    const requestId = newRequestId()
    const deferred = await Effect.runPromise(Deferred.make<Decision>())
    await Effect.runPromise(
      Ref.update(managed.pending, (prev) => {
        const next = new Map(prev)
        next.set(requestId, deferred)
        return next
      }),
    )

    const record = fanout.emit(managed.sessionId, {
      kind: 'permission.requested',
      sessionId: managed.sessionId,
      turnId,
      requestId,
      request,
      timeoutAt: timeoutMs != null ? Date.now() + timeoutMs : undefined,
    })

    // Durable mirror so a restart can drain / re-emit the prompt. Only
    // persist when the event actually landed in the log (seq > 0); if the
    // log write degraded there's no point — replay won't see it.
    if (pendingPermissions && record.seq > 0) {
      try {
        pendingPermissions.insert({
          requestId,
          sessionId: managed.sessionId,
          turnId,
          eventSeq: record.seq,
          request,
        })
      } catch (err) {
        logger?.('pendingPermissions.insert failed', { requestId, err })
      }
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise =
      timeoutMs != null
        ? new Promise<Decision>((resolve) => {
            timer = setTimeout(
              () =>
                resolve({
                  behaviour: 'deny',
                  scope: 'once',
                  message: 'timed out',
                }),
              timeoutMs,
            )
          })
        : null

    const decisionPromise = Effect.runPromise(Deferred.await(deferred))
    const decision = await (timeoutPromise ? Promise.race([decisionPromise, timeoutPromise]) : decisionPromise)
    if (timer) clearTimeout(timer)

    // Clean up pending map — safe whether the user resolved or timed out.
    await Effect.runPromise(
      Ref.update(managed.pending, (prev) => {
        if (!prev.has(requestId)) return prev
        const next = new Map(prev)
        next.delete(requestId)
        return next
      }),
    )

    fanout.emit(managed.sessionId, {
      kind: 'permission.resolved',
      sessionId: managed.sessionId,
      turnId,
      requestId: requestId as RequestId,
      decision,
    })

    if (pendingPermissions) {
      try {
        pendingPermissions.resolve(requestId, decision)
      } catch (err) {
        logger?.('pendingPermissions.resolve failed', { requestId, err })
      }
    }

    if (permissionPolicies && decision.scope === 'always') {
      try {
        permissionPolicies.save({
          sessionId: managed.sessionId,
          providerId: managed.providerId,
          workspaceId: managed.workspaceId,
          cwd: managed.cwd,
          request,
          decision,
        })
      } catch (err) {
        logger?.('permissionPolicies.save failed', { sessionId: managed.sessionId, requestId, err })
      }
    }

    return decision
  }

  const awaitQuestion = async (
    _questionIdFromProvider: string,
    prompt: string,
    options?: ReadonlyArray<QuestionOption>,
  ): Promise<QuestionAnswer> => {
    const questionId = newQuestionId()
    const deferred = await Effect.runPromise(Deferred.make<QuestionAnswer>())
    await Effect.runPromise(
      Ref.update(managed.questions, (prev) => {
        const next = new Map(prev)
        next.set(questionId, deferred)
        return next
      }),
    )

    fanout.emit(managed.sessionId, {
      kind: 'question.requested',
      sessionId: managed.sessionId,
      turnId,
      questionId,
      question: prompt,
      options: options ? [...options] : undefined,
      allowFreeform: options == null,
    })

    const answer = await Effect.runPromise(Deferred.await(deferred))

    await Effect.runPromise(
      Ref.update(managed.questions, (prev) => {
        if (!prev.has(questionId)) return prev
        const next = new Map(prev)
        next.delete(questionId)
        return next
      }),
    )

    fanout.emit(managed.sessionId, {
      kind: 'question.resolved',
      sessionId: managed.sessionId,
      turnId,
      questionId: questionId as QuestionId,
      answer,
    })

    return answer
  }

  return {
    sessionId: managed.sessionId,
    turnId,
    emit: (event) => fanout.emit(managed.sessionId, event),
    awaitPermission,
    awaitQuestion,
    signal: abort.signal,
  }
}

/** Resolve a pending permission Deferred. Returns whether the id existed. */
export function resolvePermission(
  managed: ManagedSession,
  requestId: RequestId,
  decision: Decision,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const map = yield* Ref.get(managed.pending)
    const deferred = map.get(requestId)
    if (!deferred) return false
    // Use Deferred.complete to avoid double-resolve throwing.
    const completed = yield* Deferred.succeed(deferred, decision)
    return completed
  })
}

/** Resolve a pending question Deferred. */
export function resolveQuestion(
  managed: ManagedSession,
  questionId: QuestionId,
  answer: QuestionAnswer,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const map = yield* Ref.get(managed.questions)
    const deferred = map.get(questionId)
    if (!deferred) return false
    const completed = yield* Deferred.succeed(deferred, answer)
    return completed
  })
}
