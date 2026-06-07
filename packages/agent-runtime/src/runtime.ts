// -----------------------------------------------------------------------------
// AgentRuntime — top-level service the oRPC router composes against.
//
// The methods here mirror 1:1 the `agent.session.*` procedures; each
// handler is a thin caller that returns the runtime's output shape. Durable
// session state lives behind SessionStore, while hot provider processes are
// tracked in the in-memory registry.
// -----------------------------------------------------------------------------

import {
  type AttachmentRef,
  type CancelSessionInput,
  type CancelSessionOutput,
  type CloseSessionInput,
  type CloseSessionOutput,
  type CreateSessionInput,
  type CreateSessionOutput,
  type ImageRef,
  newMessageId,
  newSessionId,
  newTurnId,
  type PromptInput,
  type PromptOutput,
  type ReasoningEffort,
  type RespondPermissionInput,
  type RespondPermissionOutput,
  type RespondQuestionInput,
  type RespondQuestionOutput,
  type SessionId,
  type SetModeInput,
  type SetModelInput,
  type SetModelOutput,
  type SetModeOutput,
  type SetReasoningEffortInput,
  type SetReasoningEffortOutput,
  type StartReviewInput,
  type StartReviewOutput,
  type TurnId,
} from '@wanda/agent-protocol'
import type { EventLog } from '@wanda/event-log'
import type { SubscriptionManager } from '@wanda/subscriptions'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Ref from 'effect/Ref'
import * as Scope from 'effect/Scope'
import {
  AgentBusy,
  CapabilityHandshakeFailed,
  InvalidMode,
  InvalidModel,
  PermissionAlreadyResolved,
  PermissionNotFound,
  PromptEmpty,
  ProviderNotFound,
  ProviderUnavailable,
  QuestionAlreadyResolved,
  QuestionNotFound,
  RuntimeInternal,
  SessionClosed,
  SessionNotFound,
  TurnMismatch,
} from './errors.ts'
import type { EventFanout } from './event-fanout.ts'
import { makeEventFanout } from './event-fanout.ts'
import { type ActiveTurn, type ManagedSession, makeManagedSession } from './managed-session.ts'
import type { PendingPermissionsStore } from './pending-permissions-store.ts'
import type { PermissionPolicyStore } from './permission-policy-store.ts'
import { makeProviderRegistry } from './provider-registry.ts'
import { makeSessionRegistry } from './session-registry.ts'
import type { SessionStore } from './session-store.ts'
import type { SessionState, SessionStateTag } from './state-machine.ts'
import { canTransition } from './state-machine.ts'
import { resolvePermission, resolveQuestion, runTurn } from './turn-runner.ts'
import type { AgentProvider } from './types.ts'

// --- Public shapes ------------------------------------------------------------

export interface SessionDetail {
  readonly sessionId: SessionId
  readonly providerId: string
  readonly workspaceId: string | null
  readonly cwd: string
  readonly currentModeId: string | null
  readonly currentModelId: string | null
  readonly currentReasoningEffort: ReasoningEffort | null
  readonly capabilities: import('@wanda/agent-protocol').AgentCapabilities
  readonly modes: ReadonlyArray<import('@wanda/agent-protocol').AgentMode>
  readonly modelOptions: ReadonlyArray<import('@wanda/agent-protocol').ModelOption>
  readonly runtimeState: SessionStateTag
}

export interface SessionSummary {
  readonly sessionId: SessionId
  readonly providerId: string
  readonly runtimeState: SessionStateTag
}

/** Lightweight row for listing sessions pulled from the store. */
export interface PersistedSessionSummary {
  readonly sessionId: SessionId
  readonly providerId: string
  readonly workspaceId: string | null
  readonly podId: string | null
  readonly cwd: string
  readonly title: string | null
  readonly titleSource: 'auto' | 'user'
  readonly currentModeId: string | null
  readonly currentModelId: string | null
  readonly currentReasoningEffort: ReasoningEffort | null
  readonly state: SessionStateTag
  readonly lastEventSeq: number | null
  readonly lastEventAt: number | null
  readonly archivedAt: number | null
  readonly createdAt: number
  /** True when the session is currently resident in memory (hot). */
  readonly resident: boolean
}

// --- AgentRuntime Tag ---------------------------------------------------------

export class AgentRuntime extends Context.Tag('@wanda/AgentRuntime')<
  AgentRuntime,
  {
    readonly create: (
      input: CreateSessionInput,
    ) => Effect.Effect<
      CreateSessionOutput,
      ProviderNotFound | ProviderUnavailable | CapabilityHandshakeFailed | RuntimeInternal
    >
    readonly prompt: (
      input: PromptInput,
    ) => Effect.Effect<
      PromptOutput,
      SessionNotFound | SessionClosed | AgentBusy | PromptEmpty | InvalidMode | RuntimeInternal
    >
    readonly cancel: (
      input: CancelSessionInput & { turnId?: TurnId },
    ) => Effect.Effect<CancelSessionOutput, SessionNotFound | TurnMismatch | RuntimeInternal>
    readonly setMode: (
      input: SetModeInput,
    ) => Effect.Effect<SetModeOutput, SessionNotFound | SessionClosed | AgentBusy | InvalidMode | RuntimeInternal>
    readonly setModel: (
      input: SetModelInput,
    ) => Effect.Effect<SetModelOutput, SessionNotFound | SessionClosed | AgentBusy | InvalidModel | RuntimeInternal>
    readonly setReasoningEffort: (
      input: SetReasoningEffortInput,
    ) => Effect.Effect<
      SetReasoningEffortOutput,
      SessionNotFound | SessionClosed | AgentBusy | InvalidModel | RuntimeInternal
    >
    /**
     * Kick off a provider-native code review as a turn. Only valid when
     * the session's `capabilities.supportsReview` is true; otherwise
     * fails with `RuntimeInternal` (the UI should be gating this to
     * sessions that advertise support).
     */
    readonly startReview: (
      input: StartReviewInput,
    ) => Effect.Effect<StartReviewOutput, SessionNotFound | SessionClosed | AgentBusy | PromptEmpty | RuntimeInternal>
    readonly respondPermission: (
      input: RespondPermissionInput,
    ) => Effect.Effect<
      RespondPermissionOutput,
      SessionNotFound | PermissionNotFound | PermissionAlreadyResolved | RuntimeInternal
    >
    readonly respondQuestion: (
      input: RespondQuestionInput,
    ) => Effect.Effect<
      RespondQuestionOutput,
      SessionNotFound | QuestionNotFound | QuestionAlreadyResolved | RuntimeInternal
    >
    readonly close: (input: CloseSessionInput) => Effect.Effect<CloseSessionOutput, SessionNotFound | RuntimeInternal>
    readonly get: (
      sessionId: SessionId,
    ) => Effect.Effect<SessionDetail, SessionNotFound | SessionClosed | RuntimeInternal>
    readonly list: Effect.Effect<ReadonlyArray<SessionSummary>, RuntimeInternal>
    /**
     * List persisted sessions (DB-backed). Merges in-memory runtime state
     * onto each row so callers can tell which sessions are hot. Empty array
     * when no `sessionStore` is configured.
     */
    readonly listPersisted: (filter?: {
      readonly workspaceId?: string | null
      readonly includeArchived?: boolean
    }) => Effect.Effect<ReadonlyArray<PersistedSessionSummary>, RuntimeInternal>
    /** Soft-delete a session row. Does not close the live session. */
    readonly archive: (sessionId: SessionId) => Effect.Effect<void, SessionNotFound | RuntimeInternal>
    /** Reverse `archive`: clear `archivedAt` so the row reappears in listings. */
    readonly unarchive: (sessionId: SessionId) => Effect.Effect<void, SessionNotFound | RuntimeInternal>
    /** Set the user-chosen title for a session. Overwrites any auto-title. */
    readonly rename: (sessionId: SessionId, title: string) => Effect.Effect<void, SessionNotFound | RuntimeInternal>
    /**
     * Boot hook. For every `agent_pending_permissions` row left unresolved
     * from a prior process, emit a synthetic `permission.resolved` event so
     * replay-backed UIs stop showing the prompt, then mark the row resolved
     * with a `deny` decision. Safe to call when no `pendingPermissions` is
     * configured (no-ops). Returns the number of rows drained.
     */
    readonly drainPendingPermissions: () => Effect.Effect<number, RuntimeInternal>
  }
>() {}

// --- Helpers ------------------------------------------------------------------

const TITLE_MAX_LEN = 60

/** Extract a display title from the user's prompt blocks. */
function firstPromptTitle(content: ReadonlyArray<import('@wanda/agent-protocol').PromptBlock>): string {
  for (const block of content) {
    if (block.kind === 'text' && block.text.trim().length > 0) {
      const flat = block.text.trim().replace(/\s+/g, ' ')
      return flat.length > TITLE_MAX_LEN ? `${flat.slice(0, TITLE_MAX_LEN - 1)}…` : flat
    }
  }
  return ''
}

/**
 * Human-readable label for a review target. Surfaced as a synthetic user
 * message at the start of a review turn so the transcript shows intent
 * (e.g. "/review uncommitted changes") — otherwise the assistant's
 * response floats with no trigger.
 */
function reviewTargetLabel(target: import('@wanda/agent-protocol').ReviewTarget): string {
  switch (target.type) {
    case 'uncommittedChanges':
      return 'uncommitted changes'
    case 'baseBranch':
      return `changes vs ${target.branch}`
    case 'commit':
      return `commit ${target.title ? `${target.title} (${target.sha.slice(0, 7)})` : target.sha.slice(0, 7)}`
    case 'custom':
      return target.instructions.length > 80 ? `${target.instructions.slice(0, 79)}…` : target.instructions
  }
}

// --- Live implementation ------------------------------------------------------

export interface AgentRuntimeDeps {
  readonly eventLog: EventLog
  readonly subscriptions: SubscriptionManager
  readonly providers: ReadonlyArray<AgentProvider>
  /**
   * Optional persistence hook. When set, the runtime writes session rows on
   * `create` / `close` and rehydrates from this store on a `get` miss.
   * Tests and one-shot embeddings may omit this.
   */
  readonly sessionStore?: SessionStore
  /**
   * Optional durable mirror for outstanding permission prompts. When set,
   * `permission.requested` emissions are mirrored to the store so a boot-time
   * drain can synthesize `deny` for any row left hanging.
   */
  readonly pendingPermissions?: PendingPermissionsStore
  /**
   * Optional persisted policy resolver for user decisions saved with
   * `scope: "always"`.
   */
  readonly permissionPolicies?: PermissionPolicyStore
  readonly now?: () => number
  readonly logger?: (message: string, ctx?: unknown) => void
}

/**
 * Build a concrete `AgentRuntime`. The returned service uses real
 * `SessionRegistry` + `ProviderRegistry` + `EventFanout`; providers and
 * their scopes are tracked internally.
 */
export function makeAgentRuntime(deps: AgentRuntimeDeps): Context.Tag.Service<typeof AgentRuntime> {
  const now = deps.now ?? Date.now
  const registry = makeSessionRegistry({ now })
  const providerRegistry = makeProviderRegistry(deps.providers)
  const store = deps.sessionStore
  const pendingPermissions = deps.pendingPermissions
  const permissionPolicies = deps.permissionPolicies
  const fanout: EventFanout = makeEventFanout({
    eventLog: deps.eventLog,
    subscriptions: deps.subscriptions,
    sessionStore: store,
    now,
    logger: deps.logger,
  })

  const readState = (sessionId: SessionId) =>
    Effect.gen(function* () {
      const managed = yield* registry.get(sessionId)
      if (!managed) return yield* Effect.fail(new SessionNotFound({ sessionId }))
      const state = yield* Ref.get(managed.state)
      return { managed, state }
    })

  /**
   * Hot path: registry hit. Cold path: load the persisted row, ask the
   * provider to resume (or spawn fresh with the stored handle if resume
   * isn't supported), and register the fresh `ManagedSession`. The original
   * `session.started` stays in the event log so replay still renders history;
   * we intentionally do NOT re-emit it.
   */
  const getOrResurrect = (
    sessionId: SessionId,
  ): Effect.Effect<ManagedSession, SessionNotFound | SessionClosed | RuntimeInternal> =>
    Effect.gen(function* () {
      const hot = yield* registry.get(sessionId)
      if (hot) return hot
      if (!store) return yield* Effect.fail(new SessionNotFound({ sessionId }))
      const snapshot = store.findById(sessionId)
      if (!snapshot) return yield* Effect.fail(new SessionNotFound({ sessionId }))
      if (snapshot.state === 'closed') {
        return yield* Effect.fail(new SessionClosed({ sessionId }))
      }
      const provider = yield* providerRegistry.get(snapshot.providerId as import('@wanda/agent-protocol').ProviderId)
      if (!provider) {
        return yield* Effect.fail(new RuntimeInternal({ message: `provider ${snapshot.providerId} not registered` }))
      }
      const scope = yield* Scope.make()
      const ctx = {
        sessionId,
        cwd: snapshot.cwd,
        env: {},
        workspaceId: snapshot.workspaceId,
        resumeHandle: snapshot.persistenceHandle ?? undefined,
        modeId: (snapshot.currentModeId ?? undefined) as import('@wanda/agent-protocol').ModeId | undefined,
        modelId: (snapshot.currentModelId ?? undefined) as import('@wanda/agent-protocol').ModelId | undefined,
        reasoningEffort: snapshot.currentReasoningEffort ?? undefined,
      }
      const acquire =
        provider.manifest.staticCapabilities.supportsSessionResume && provider.resume
          ? provider.resume(ctx)
          : provider.spawn(ctx)
      const session = yield* acquire.pipe(
        Scope.extend(scope),
        Effect.mapError(
          (err) =>
            new RuntimeInternal({
              message: `resume failed for ${snapshot.providerId}: ${err.message}`,
              cause: err,
            }),
        ),
      )
      const managed = yield* makeManagedSession({
        sessionId,
        providerId: snapshot.providerId,
        cwd: snapshot.cwd,
        workspaceId: snapshot.workspaceId,
        session,
        scope,
        now,
      })
      yield* registry.put(managed)
      // The provider may have minted a fresh handle on resume; flush it.
      if (store) {
        try {
          store.updatePersistenceHandle(sessionId, session.persistenceHandle)
        } catch (err) {
          deps.logger?.('sessionStore.updatePersistenceHandle failed', { sessionId, err })
        }
      }
      return managed
    })

  const transition = (stateRef: Ref.Ref<SessionState>, next: SessionState): Effect.Effect<void, RuntimeInternal> =>
    Effect.gen(function* () {
      const prev = yield* Ref.get(stateRef)
      if (!canTransition(prev.tag, next.tag)) {
        return yield* Effect.fail(
          new RuntimeInternal({
            message: `illegal state transition ${prev.tag} → ${next.tag}`,
          }),
        )
      }
      yield* Ref.set(stateRef, next)
    })

  return {
    create(input) {
      return Effect.gen(function* () {
        const provider = yield* providerRegistry.get(input.providerId)
        if (!provider) {
          return yield* Effect.fail(new ProviderNotFound({ providerId: input.providerId }))
        }

        const scope = yield* Scope.make()
        const sessionId = newSessionId()

        const resumeHandle =
          input.resumeHandle && typeof input.resumeHandle === 'object'
            ? (input.resumeHandle as import('./types.ts').PersistenceHandle)
            : undefined
        const spawnCtx = {
          sessionId,
          cwd: input.cwd,
          env: {},
          workspaceId: input.workspaceId ?? null,
          resumeHandle,
          modeId: input.modeId,
          modelId: input.modelId,
          reasoningEffort: input.reasoningEffort,
          mcpServers: input.mcpServers,
        }
        const acquire =
          resumeHandle && provider.manifest.staticCapabilities.supportsSessionResume && provider.resume
            ? provider.resume(spawnCtx)
            : provider.spawn(spawnCtx)

        const session = yield* acquire.pipe(
          Scope.extend(scope),
          Effect.mapError(
            (err) =>
              new CapabilityHandshakeFailed({
                providerId: input.providerId,
                reason: err.message,
              }),
          ),
          Effect.catchAllDefect((defect) =>
            Effect.fail(
              new ProviderUnavailable({
                providerId: input.providerId,
                reason: defect instanceof Error ? defect.message : String(defect),
              }),
            ),
          ),
        )

        const managed = yield* makeManagedSession({
          sessionId,
          providerId: input.providerId as unknown as string,
          cwd: input.cwd,
          workspaceId: input.workspaceId ?? null,
          session,
          scope,
          now,
        })
        yield* registry.put(managed)

        // Durable mirror for restart-survives. Insert BEFORE the event emit
        // so a crash between them at least leaves the row present; the
        // session.started event will be re-emitted on resume (see get()).
        if (store) {
          try {
            store.insert({
              id: sessionId,
              providerId: input.providerId as unknown as string,
              workspaceId: input.workspaceId ?? null,
              podId: null,
              cwd: input.cwd,
              capabilities: session.capabilities,
              modes: session.modes,
              modelOptions: session.modelOptions,
              currentModeId: session.currentModeId ?? null,
              currentModelId: session.currentModelId ?? null,
              currentReasoningEffort: session.currentReasoningEffort ?? null,
              persistenceHandle: session.persistenceHandle,
            })
          } catch (err) {
            deps.logger?.('sessionStore.insert failed', { sessionId, err })
          }
        }

        // Persist session.started through the fanout (hits event-log + subs).
        fanout.emit(sessionId, {
          kind: 'session.started',
          sessionId,
          providerId: input.providerId,
          capabilities: session.capabilities,
          modes: [...session.modes],
          modelOptions: [...session.modelOptions],
          currentModeId: session.currentModeId ?? undefined,
          modelId: session.currentModelId ?? undefined,
          reasoningEffort: session.currentReasoningEffort ?? undefined,
          persistenceHandle: session.persistenceHandle,
        })

        return {
          sessionId,
          capabilities: session.capabilities,
          modes: [...session.modes],
          modelOptions: [...session.modelOptions],
        }
      })
    },

    prompt(input) {
      return Effect.gen(function* () {
        let managed = yield* getOrResurrect(input.sessionId)
        let state = yield* Ref.get(managed.state)
        deps.logger?.('agent-runtime.prompt:start', {
          sessionId: input.sessionId,
          state: state.tag,
          contentKinds: input.content.map((block) => block.kind),
          modeId: input.options?.modeId ?? null,
        })
        if (state.tag === 'closed') {
          return yield* Effect.fail(new SessionClosed({ sessionId: input.sessionId }))
        }
        if (state.tag === 'running') {
          return yield* Effect.fail(new AgentBusy({ sessionId: input.sessionId }))
        }
        // If the prior turn ended in a non-recoverable error (transport
        // died, provider process gone), optimistically retrying on the same
        // channel would just hang. Close the dead scope, evict from the
        // registry, and re-resurrect so the next prompt runs on a fresh
        // subprocess. Recoverable errors (provider itself reported an
        // error but the channel is alive) skip this — error → running is
        // the intended fast path.
        if (state.tag === 'error' && !state.recoverable) {
          // We explicitly don't let scope-close errors abort the evict
          // path — the subprocess may already be dead, the scope finaliser
          // may have partial state, etc. But we DO log what went wrong so
          // a masked subprocess panic isn't silently swallowed under a
          // generic "Internal Server Error" on the next failing call.
          yield* Scope.close(managed.scope, Exit.void).pipe(
            Effect.catchAllDefect((defect) =>
              Effect.sync(() =>
                deps.logger?.('prompt.evictAndRespawn: scope close threw defect', {
                  sessionId: input.sessionId,
                  defect: defect instanceof Error ? defect.message : String(defect),
                }),
              ),
            ),
            Effect.catchAll((err) =>
              Effect.sync(() =>
                deps.logger?.('prompt.evictAndRespawn: scope close failed', {
                  sessionId: input.sessionId,
                  err,
                }),
              ),
            ),
          )
          yield* registry.remove(input.sessionId)
          managed = yield* getOrResurrect(input.sessionId)
          state = yield* Ref.get(managed.state)
        }
        if (state.tag !== 'ready' && state.tag !== 'error') {
          return yield* Effect.fail(
            new AgentBusy({
              sessionId: input.sessionId,
              reason: `session state ${state.tag}`,
            }),
          )
        }
        if (input.content.length === 0) {
          return yield* Effect.fail(new PromptEmpty({ sessionId: input.sessionId }))
        }

        // Auto-title on first prompt: if the session has no title yet, use
        // the first 60 chars of the first text block. User-set titles are
        // protected server-side in `updateTitle`.
        if (store) {
          try {
            const title = firstPromptTitle(input.content)
            if (title.length > 0) {
              store.updateTitle(input.sessionId, title, 'auto')
            }
          } catch (err) {
            deps.logger?.('sessionStore.updateTitle(auto) failed', { sessionId: input.sessionId, err })
          }
        }

        if (input.options?.modeId) {
          yield* Effect.mapError(
            managed.session.setMode(input.options.modeId),
            () => new InvalidMode({ sessionId: input.sessionId, modeId: input.options!.modeId! }),
          )
          yield* Ref.set(managed.modeId, input.options.modeId)
          if (store) {
            try {
              store.updateMode(managed.sessionId, input.options.modeId as unknown as string)
            } catch (err) {
              deps.logger?.('sessionStore.updateMode (from prompt) failed', {
                sessionId: managed.sessionId,
                err,
              })
            }
          }
          fanout.emit(managed.sessionId, {
            kind: 'mode.changed',
            sessionId: managed.sessionId,
            modeId: input.options.modeId,
          })
        }

        const turnId = newTurnId()
        const abort = new AbortController()

        // Fork the turn fiber BEFORE emitting turn.started so the state
        // ref carries the active fiber when the event lands — a race
        // between a subscriber calling cancel() and the emit is fine: the
        // turn fiber is already alive when the transition commits.
        const fiber = yield* Effect.forkDaemon(
          runTurn({
            managed,
            turnId,
            body: { kind: 'prompt', content: [...input.content] },
            abort,
            fanout,
            now,
            store,
            pendingPermissions,
            permissionPolicies,
            logger: deps.logger,
          }),
        )

        const active: ActiveTurn = { turnId, fiber, abort, startedAt: now() }
        yield* Ref.set(managed.activeTurn, active)
        yield* transition(managed.state, {
          tag: 'running',
          turnId,
          startedAt: active.startedAt,
        })

        fanout.emit(managed.sessionId, {
          kind: 'turn.started',
          sessionId: managed.sessionId,
          turnId,
        })
        deps.logger?.('agent-runtime.prompt:turn-started', {
          sessionId: managed.sessionId,
          turnId,
        })

        // Emit the user-side message AFTER turn.started so replay ordering
        // is: turn.started → (user said X) → assistant deltas → turn.completed.
        // Only text + attachments are represented; mentions / commands /
        // resources are dropped at this boundary (non-rendered content).
        const userText = input.content
          .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
          .map((b) => b.text)
          .join('\n')
        const userAttachments = input.content.filter(
          (b): b is AttachmentRef | ImageRef => b.kind === 'attachment' || b.kind === 'image',
        )
        if (userText.length > 0 || userAttachments.length > 0) {
          fanout.emit(managed.sessionId, {
            kind: 'text.completed',
            sessionId: managed.sessionId,
            turnId,
            messageId: newMessageId(),
            text: userText,
            role: 'user',
            attachments: userAttachments.length > 0 ? userAttachments : undefined,
          })
          deps.logger?.('agent-runtime.prompt:user-echo-emitted', {
            sessionId: managed.sessionId,
            turnId,
            textLength: userText.length,
            attachmentCount: userAttachments.length,
          })
        }

        yield* Ref.set(managed.lastActiveAt, now())
        deps.logger?.('agent-runtime.prompt:return', {
          sessionId: managed.sessionId,
          turnId,
        })

        return { turnId }
      })
    },

    startReview(input) {
      return Effect.gen(function* () {
        const managed = yield* getOrResurrect(input.sessionId)
        const state = yield* Ref.get(managed.state)
        if (state.tag === 'closed') {
          return yield* Effect.fail(new SessionClosed({ sessionId: input.sessionId }))
        }
        if (state.tag === 'running') {
          return yield* Effect.fail(new AgentBusy({ sessionId: input.sessionId }))
        }
        // `supportsReview` + the session method are advertised together —
        // the UI gates the button on the capability flag, but double-check
        // here so a mis-configured provider doesn't produce a silent hang.
        if (!managed.session.capabilities.supportsReview || !managed.session.startReview) {
          return yield* Effect.fail(
            new RuntimeInternal({
              message: `provider ${managed.providerId} does not support review turns`,
            }),
          )
        }
        if (state.tag !== 'ready' && state.tag !== 'error') {
          return yield* Effect.fail(
            new AgentBusy({
              sessionId: input.sessionId,
              reason: `session state ${state.tag}`,
            }),
          )
        }

        const turnId = newTurnId()
        const abort = new AbortController()
        const fiber = yield* Effect.forkDaemon(
          runTurn({
            managed,
            turnId,
            body: { kind: 'review', target: input.target },
            abort,
            fanout,
            now,
            store,
            pendingPermissions,
            permissionPolicies,
            logger: deps.logger,
          }),
        )
        const active: ActiveTurn = { turnId, fiber, abort, startedAt: now() }
        yield* Ref.set(managed.activeTurn, active)
        yield* transition(managed.state, {
          tag: 'running',
          turnId,
          startedAt: active.startedAt,
        })
        fanout.emit(managed.sessionId, {
          kind: 'turn.started',
          sessionId: managed.sessionId,
          turnId,
        })

        // Emit a user-visible marker so the transcript shows *why* the
        // turn started. Without this, a review appears as an assistant
        // reply with no preceding user message — confusing in replay.
        const label = reviewTargetLabel(input.target)
        fanout.emit(managed.sessionId, {
          kind: 'text.completed',
          sessionId: managed.sessionId,
          turnId,
          messageId: newMessageId(),
          text: `/review ${label}`,
          role: 'user',
        })

        yield* Ref.set(managed.lastActiveAt, now())
        return { turnId }
      })
    },

    cancel(input) {
      return Effect.gen(function* () {
        const { managed, state } = yield* readState(input.sessionId)
        if (state.tag !== 'running') {
          return { cancelled: false }
        }
        const active = yield* Ref.get(managed.activeTurn)
        if (!active) return { cancelled: false }
        if (input.turnId != null && input.turnId !== active.turnId) {
          return yield* Effect.fail(
            new TurnMismatch({
              sessionId: input.sessionId,
              turnId: input.turnId,
              currentTurnId: active.turnId,
            }),
          )
        }

        active.abort.abort()
        // `Fiber.interrupt` awaits the fiber's exit internally and yields the
        // Exit. runTurn's `matchCauseEffect` + `catchAllCause` absorbs the
        // interrupt into a success(void), so the returned Exit is a Success
        // — we discard it. No separate Fiber.join needed.
        yield* Fiber.interrupt(active.fiber)
        yield* Ref.set(managed.activeTurn, null)
        return { cancelled: true }
      })
    },

    setMode(input) {
      return Effect.gen(function* () {
        const { managed, state } = yield* readState(input.sessionId)
        if (state.tag === 'closed') {
          return yield* Effect.fail(new SessionClosed({ sessionId: input.sessionId }))
        }
        if (state.tag === 'running') {
          return yield* Effect.fail(new AgentBusy({ sessionId: input.sessionId, reason: 'turn active' }))
        }
        yield* Effect.mapError(
          managed.session.setMode(input.modeId),
          () => new InvalidMode({ sessionId: input.sessionId, modeId: input.modeId }),
        )
        yield* Ref.set(managed.modeId, input.modeId)
        if (store) {
          try {
            store.updateMode(managed.sessionId, input.modeId as unknown as string)
          } catch (err) {
            deps.logger?.('sessionStore.updateMode failed', { sessionId: managed.sessionId, err })
          }
        }
        fanout.emit(managed.sessionId, {
          kind: 'mode.changed',
          sessionId: managed.sessionId,
          modeId: input.modeId,
        })
        return { modeId: input.modeId }
      })
    },

    setModel(input) {
      return Effect.gen(function* () {
        const { managed, state } = yield* readState(input.sessionId)
        if (state.tag === 'closed') {
          return yield* Effect.fail(new SessionClosed({ sessionId: input.sessionId }))
        }
        if (state.tag === 'running') {
          return yield* Effect.fail(new AgentBusy({ sessionId: input.sessionId, reason: 'turn active' }))
        }
        yield* Effect.mapError(
          managed.session.setModel(input.modelId),
          () => new InvalidModel({ sessionId: input.sessionId, modelId: input.modelId }),
        )
        yield* Ref.set(managed.modelId, input.modelId)
        const selectedModel = managed.session.modelOptions.find((m) => m.id === input.modelId)
        const currentEffort = yield* Ref.get(managed.reasoningEffort)
        const allowedEfforts = selectedModel?.supportedReasoningEfforts
        if (
          currentEffort != null &&
          allowedEfforts &&
          allowedEfforts.length > 0 &&
          !allowedEfforts.includes(currentEffort)
        ) {
          const nextEffort = selectedModel.defaultReasoningEffort ?? allowedEfforts[0]!
          yield* Effect.mapError(
            managed.session.setReasoningEffort(nextEffort),
            () => new InvalidModel({ sessionId: input.sessionId, modelId: input.modelId }),
          )
          yield* Ref.set(managed.reasoningEffort, nextEffort)
          if (store) {
            try {
              store.updateReasoningEffort(managed.sessionId, nextEffort)
            } catch (err) {
              deps.logger?.('sessionStore.updateReasoningEffort (from setModel) failed', {
                sessionId: managed.sessionId,
                err,
              })
            }
          }
          fanout.emit(managed.sessionId, {
            kind: 'reasoning.effort.changed',
            sessionId: managed.sessionId,
            reasoningEffort: nextEffort,
          })
        }
        if (store) {
          try {
            store.updateModel(managed.sessionId, input.modelId as unknown as string)
          } catch (err) {
            deps.logger?.('sessionStore.updateModel failed', { sessionId: managed.sessionId, err })
          }
        }
        fanout.emit(managed.sessionId, {
          kind: 'model.changed',
          sessionId: managed.sessionId,
          modelId: input.modelId,
        })
        return { modelId: input.modelId }
      })
    },

    setReasoningEffort(input) {
      return Effect.gen(function* () {
        const { managed, state } = yield* readState(input.sessionId)
        if (state.tag === 'closed') {
          return yield* Effect.fail(new SessionClosed({ sessionId: input.sessionId }))
        }
        if (state.tag === 'running') {
          return yield* Effect.fail(new AgentBusy({ sessionId: input.sessionId, reason: 'turn active' }))
        }
        yield* Effect.mapError(
          managed.session.setReasoningEffort(input.reasoningEffort),
          () => new InvalidModel({ sessionId: input.sessionId, modelId: input.reasoningEffort as never }),
        )
        yield* Ref.set(managed.reasoningEffort, input.reasoningEffort)
        if (store) {
          try {
            store.updateReasoningEffort(managed.sessionId, input.reasoningEffort)
          } catch (err) {
            deps.logger?.('sessionStore.updateReasoningEffort failed', { sessionId: managed.sessionId, err })
          }
        }
        fanout.emit(managed.sessionId, {
          kind: 'reasoning.effort.changed',
          sessionId: managed.sessionId,
          reasoningEffort: input.reasoningEffort,
        })
        return { reasoningEffort: input.reasoningEffort }
      })
    },

    respondPermission(input) {
      return Effect.gen(function* () {
        const { managed } = yield* readState(input.sessionId)
        const pending = yield* Ref.get(managed.pending)
        const deferred = pending.get(input.requestId)
        if (!deferred) {
          return yield* Effect.fail(new PermissionNotFound({ requestId: input.requestId }))
        }
        const accepted = yield* resolvePermission(managed, input.requestId, input.decision)
        if (!accepted) {
          return yield* Effect.fail(new PermissionAlreadyResolved({ requestId: input.requestId }))
        }
        // Mirror to the durable store directly here too. awaitPermission
        // will also call resolve when it wakes up, but the store is
        // idempotent and this guarantees the row settles even if the server
        // is killed before awaitPermission's continuation runs.
        if (pendingPermissions) {
          try {
            pendingPermissions.resolve(input.requestId, input.decision)
          } catch (err) {
            deps.logger?.('pendingPermissions.resolve (respond) failed', {
              requestId: input.requestId,
              err,
            })
          }
        }
        return { accepted: true }
      })
    },

    respondQuestion(input) {
      return Effect.gen(function* () {
        const { managed } = yield* readState(input.sessionId)
        const questions = yield* Ref.get(managed.questions)
        const deferred = questions.get(input.questionId)
        if (!deferred) {
          return yield* Effect.fail(new QuestionNotFound({ questionId: input.questionId }))
        }
        const accepted = yield* resolveQuestion(managed, input.questionId, input.answer)
        if (!accepted) {
          return yield* Effect.fail(new QuestionAlreadyResolved({ questionId: input.questionId }))
        }
        return { accepted: true }
      })
    },

    close(input) {
      return Effect.gen(function* () {
        const managed = yield* registry.get(input.sessionId)
        if (!managed) {
          return yield* Effect.fail(new SessionNotFound({ sessionId: input.sessionId }))
        }
        const state = yield* Ref.get(managed.state)
        if (state.tag === 'closed') return { closed: true }

        // If a turn is in flight, interrupt it first so the fiber can wind
        // down via its own finaliser (drain pendings, emit turn.cancelled).
        const active = yield* Ref.get(managed.activeTurn)
        if (active) {
          active.abort.abort()
          yield* Fiber.interrupt(active.fiber)
          yield* Ref.set(managed.activeTurn, null)
        }

        yield* Scope.close(managed.scope, Exit.void)
        yield* Ref.set(managed.state, {
          tag: 'closed',
          at: now(),
          reason: 'user',
        })
        if (store) {
          try {
            store.markClosed(managed.sessionId, 'user')
          } catch (err) {
            deps.logger?.('sessionStore.markClosed failed', { sessionId: managed.sessionId, err })
          }
        }
        fanout.emit(managed.sessionId, {
          kind: 'session.closed',
          sessionId: managed.sessionId,
          reason: 'user',
        })
        yield* registry.remove(input.sessionId)
        return { closed: true }
      })
    },

    get(sessionId) {
      return Effect.gen(function* () {
        const managed = yield* getOrResurrect(sessionId).pipe(Effect.catchTag('SessionClosed', (e) => Effect.fail(e)))
        const state = yield* Ref.get(managed.state)
        const modeId = yield* Ref.get(managed.modeId)
        const modelId = yield* Ref.get(managed.modelId)
        const reasoningEffort = yield* Ref.get(managed.reasoningEffort)
        return {
          sessionId: managed.sessionId,
          providerId: managed.providerId,
          workspaceId: managed.workspaceId,
          cwd: managed.cwd,
          currentModeId: modeId ? (modeId as unknown as string) : null,
          currentModelId: modelId ? (modelId as unknown as string) : null,
          currentReasoningEffort: reasoningEffort,
          capabilities: managed.session.capabilities,
          modes: managed.session.modes,
          modelOptions: managed.session.modelOptions,
          runtimeState: state.tag,
        } satisfies SessionDetail
      })
    },

    list: Effect.gen(function* () {
      const all = yield* registry.list
      const out: SessionSummary[] = []
      for (const managed of all) {
        const state = yield* Ref.get(managed.state)
        out.push({
          sessionId: managed.sessionId,
          providerId: managed.providerId,
          runtimeState: state.tag,
        })
      }
      return out
    }),

    listPersisted(filter) {
      return Effect.gen(function* () {
        if (!store) return []
        const rows = store.list({
          workspaceId: filter?.workspaceId,
          includeArchived: filter?.includeArchived ?? false,
        })
        const out: PersistedSessionSummary[] = []
        for (const row of rows) {
          const hot = yield* registry.get(row.id)
          const runtimeState = hot ? (yield* Ref.get(hot.state)).tag : row.state
          out.push({
            sessionId: row.id,
            providerId: row.providerId,
            workspaceId: row.workspaceId,
            podId: row.podId,
            cwd: row.cwd,
            title: row.title,
            titleSource: row.titleSource,
            currentModeId: row.currentModeId,
            currentModelId: row.currentModelId,
            currentReasoningEffort: row.currentReasoningEffort,
            state: runtimeState,
            lastEventSeq: row.lastEventSeq,
            lastEventAt: row.lastEventAt,
            archivedAt: row.archivedAt,
            createdAt: row.createdAt,
            resident: hot != null,
          })
        }
        return out
      })
    },

    archive(sessionId) {
      return Effect.gen(function* () {
        if (!store) {
          return yield* Effect.fail(new RuntimeInternal({ message: 'archive requires a sessionStore' }))
        }
        const row = store.findById(sessionId)
        if (!row) return yield* Effect.fail(new SessionNotFound({ sessionId }))
        try {
          store.archive(sessionId)
        } catch (err) {
          deps.logger?.('sessionStore.archive failed', { sessionId, err })
          return yield* Effect.fail(
            new RuntimeInternal({
              message: `archive failed: ${err instanceof Error ? err.message : String(err)}`,
              cause: err,
            }),
          )
        }
      })
    },

    unarchive(sessionId) {
      return Effect.gen(function* () {
        if (!store) {
          return yield* Effect.fail(new RuntimeInternal({ message: 'unarchive requires a sessionStore' }))
        }
        const row = store.findById(sessionId)
        if (!row) return yield* Effect.fail(new SessionNotFound({ sessionId }))
        try {
          store.unarchive(sessionId)
        } catch (err) {
          deps.logger?.('sessionStore.unarchive failed', { sessionId, err })
          return yield* Effect.fail(
            new RuntimeInternal({
              message: `unarchive failed: ${err instanceof Error ? err.message : String(err)}`,
              cause: err,
            }),
          )
        }
      })
    },

    rename(sessionId, title) {
      return Effect.gen(function* () {
        if (!store) {
          return yield* Effect.fail(new RuntimeInternal({ message: 'rename requires a sessionStore' }))
        }
        const row = store.findById(sessionId)
        if (!row) return yield* Effect.fail(new SessionNotFound({ sessionId }))
        const clean = title.trim().slice(0, TITLE_MAX_LEN)
        if (clean.length === 0) {
          return yield* Effect.fail(new RuntimeInternal({ message: 'rename: title must be non-empty' }))
        }
        try {
          store.updateTitle(sessionId, clean, 'user')
        } catch (err) {
          deps.logger?.('sessionStore.updateTitle(user) failed', { sessionId, err })
          return yield* Effect.fail(
            new RuntimeInternal({
              message: `rename failed: ${err instanceof Error ? err.message : String(err)}`,
              cause: err,
            }),
          )
        }
      })
    },

    drainPendingPermissions() {
      return Effect.gen(function* () {
        if (!pendingPermissions) return 0
        let rows: ReadonlyArray<import('./pending-permissions-store.ts').PendingPermissionRow>
        try {
          rows = pendingPermissions.listUnresolved()
        } catch (err) {
          deps.logger?.('pendingPermissions.listUnresolved failed', { err })
          return yield* Effect.fail(
            new RuntimeInternal({
              message: `drainPendingPermissions: listUnresolved failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
              cause: err,
            }),
          )
        }
        if (rows.length === 0) return 0

        const decision = {
          behaviour: 'deny' as const,
          scope: 'once' as const,
          message: 'server restarted',
        }
        for (const row of rows) {
          // Emit the resolved event so the event log carries a matching
          // permission.resolved — when a client reconnects and replays, the
          // UI reducer will mark the prompt closed instead of leaving it
          // hanging. The live session is cold (registry miss) so no live
          // subscriber will receive this emission; only the log matters.
          try {
            fanout.emit(row.sessionId, {
              kind: 'permission.resolved',
              sessionId: row.sessionId,
              turnId: row.turnId,
              requestId: row.requestId,
              decision,
            })
          } catch (err) {
            deps.logger?.('drainPendingPermissions: fanout.emit failed', {
              requestId: row.requestId,
              err,
            })
          }
          try {
            pendingPermissions.resolve(row.requestId, decision)
          } catch (err) {
            deps.logger?.('drainPendingPermissions: resolve failed', {
              requestId: row.requestId,
              err,
            })
          }
        }
        return rows.length
      })
    },
  }
}
