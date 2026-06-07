// -----------------------------------------------------------------------------
// Direct Codex app-server provider.
//
// Spawns `codex app-server` as a subprocess per Wanda session, speaks the
// native JSON-RPC 2.0 protocol directly, and translates Codex-side
// notifications + server-to-client requests into Wanda AgentEvents. No ACP
// shim, no extra process hop — this is the spec 07 §1.2 "option B"
// implementation adapted to Wanda's package layout.
//
// Scope (v1):
//   * initialize + initialized + model/list + collaborationMode/list + account/read
//   * thread/start (spawn) / thread/resume (resume)
//   * turn/start — text + image input blocks
//   * turn.started / turn.completed / turn.cancelled
//   * assistantMessage text deltas + completion
//   * reasoning text deltas + completion
//   * commandExecution / fileChange / mcpToolCall / webSearch items (as tools)
//   * turn/plan/updated → plan.updated
//   * item/commandExecution/requestApproval + item/fileChange/requestApproval
//     (plus legacy aliases) → permission bridge
//   * setMode / setModel — local state, applied on next turn/start
//   * turn/interrupt on cancel; SIGTERM/SIGKILL on scope close
//
// Deferred (noted, not shipped): user-input questions, MCP elicitations,
// thread/compact, thread/fork, apply-patch live diff rendering, rate-limit
// telemetry.
// -----------------------------------------------------------------------------

import { createRequire } from 'node:module'
import { Readable, Writable } from 'node:stream'
import type {
  Decision,
  ModeId,
  ModelId,
  ModelOption,
  PermissionRequest,
  PromptBlock,
  ProviderId,
  ReasoningEffort,
  SessionId,
  StopReason,
  ToolCallId,
  TurnId,
  AgentCapabilities as WandaCapabilities,
} from '@wanda/agent-protocol'
import { newRequestId } from '@wanda/agent-protocol'
import type { AgentProvider, AgentSession, PersistenceHandle, SpawnContext, TurnContext } from '@wanda/agent-runtime'
import { AgentProviderError } from '@wanda/agent-runtime'
import * as Effect from 'effect/Effect'
import * as Ref from 'effect/Ref'
import type { z } from 'zod'
import {
  CODEX_BASE_CAPABILITIES,
  CODEX_DEFAULT_MODE_ID,
  CODEX_FALLBACK_MODEL_OPTIONS,
  CODEX_MODES,
  codexPolicyForMode,
  codexTurnSandboxPolicy,
  normalizeCodexModelLabel,
} from './capabilities.ts'
import {
  buildApprovalPermissionRequest,
  type CodexTurnContext,
  decisionToCodexApproval,
  makeTurnBuffers,
  onAgentMessageDelta,
  onCommandExecOutputDelta,
  onError,
  onItemCompleted,
  onItemStarted,
  onPlanUpdated,
  onRawResponseItemCompleted,
  onReasoningDelta,
  onTurnCompletedItems,
} from './mapper.ts'
import {
  type AccountReadResponse,
  CODEX_METHODS,
  CODEX_SERVER_NOTIFICATIONS,
  CODEX_SERVER_REQUESTS,
  type CodexModelEntry,
  type CollaborationModeListResponse,
  type CommandExecOutputDeltaNotification,
  type ErrorNotification,
  type ItemCompletedNotification,
  type ItemDeltaNotification,
  type ItemStartedNotification,
  type ModelListResponse,
  type PlanUpdatedNotification,
  type RawResponseItemCompletedNotification,
  type RequestApprovalParams,
  type ThreadStartResponse,
  type TurnCompletedNotification,
  type TurnStartedNotification,
  type TurnStartResponse,
} from './protocol.ts'
import { type CodexRpcClient, makeCodexRpcClient } from './rpc.ts'
import {
  CollaborationModeListResponseSchema,
  InitializeResponseSchema,
  ModelListResponseSchema,
  ThreadStartResponseSchema,
} from './schemas.ts'
import { spawnCodexAgent } from './spawn.ts'

const CODEX_PROVIDER_ID = 'codex' as ProviderId
const CODEX_HANDLE_VARIANT = 'codex-v1'
const CODEX_INIT_TIMEOUT_MS = 10_000

interface CodexHandle extends PersistenceHandle {
  readonly variant: typeof CODEX_HANDLE_VARIANT
  readonly providerId: string
  readonly threadId: string
  readonly cwd: string
}

export interface CodexProviderOptions {
  /**
   * Resolve the OpenAI / Codex API key. Called at each spawn so a key
   * rotated via Settings applies to new sessions without a restart.
   * Return null/undefined to let the subprocess use `~/.codex/auth.json`
   * (the preferred ChatGPT OAuth path).
   */
  readonly getApiKey?: () => string | null | undefined
  /**
   * Override the command + args used to spawn codex. Normally omitted;
   * the factory resolves `@openai/codex/bin/codex.js` from node_modules,
   * then falls back to `codex` on PATH.
   */
  readonly launchOverride?: { command: string; args: ReadonlyArray<string> }
  /**
   * Extra environment for the Codex subprocess. The shell uses this to set a
   * scoped CODEX_HOME so Codex does not read stale user MCP config.
   */
  readonly env?: Readonly<Record<string, string>> | ((ctx: SpawnContext) => Readonly<Record<string, string>>)
  /**
   * Resolve an `image` / `attachment` PromptBlock to a concrete filesystem
   * path. Codex's `turn/start` input accepts `{ type: 'localImage', path,
   * mimeType }` blocks, but the provider itself doesn't know where the
   * Wanda content-addressed blob store lives. The shell wires this
   * resolver by closing over the attachment base dir. Return `null` when
   * the blob can't be resolved (missing sha, not yet materialised) — the
   * block then falls back to a `[image:id]` text placeholder so the turn
   * still makes progress.
   */
  readonly resolveAttachmentPath?: (ref: {
    readonly id: string
    readonly sha256: string
    readonly mediaType: string
    readonly name?: string
  }) => string | null
  /**
   * Test-only: inject a pre-opened transport instead of spawning the
   * real `codex app-server` subprocess. When set, the provider skips
   * binary resolution + `spawnCodexAgent` and talks directly to the
   * supplied streams. Production callers should leave this undefined.
   */
  readonly _testTransport?: CodexTransport
}

/** Transport surface the provider needs — the only thing spawn gives us
 *  that matters inside acquire(). Exposed so tests can stand up a fake
 *  Codex server backed by `PassThrough` streams. */
export interface CodexTransport {
  readonly stdin: Writable
  readonly stdout: Readable
  readonly stderrSnapshot: () => string
}

export { CODEX_PROVIDER_ID }

export function codexDirectProvider(opts?: CodexProviderOptions): AgentProvider {
  return {
    manifest: {
      id: CODEX_PROVIDER_ID,
      label: 'Codex',
      description: 'OpenAI Codex (direct app-server). Uses your existing Codex / ChatGPT login or OPENAI_API_KEY.',
      kind: 'subprocess-stdio',
      staticCapabilities: {
        supportsSessionResume: true,
        supportsMcpServers: true,
        requiresApiKey: false,
        requiresLogin: true,
        desktopOnly: true,
      },
      docsUrl: 'https://developers.openai.com/codex',
    },

    // Cheap probe: resolve the binary. A full handshake probe would spawn
    // the process; we defer that to actual session create so detect()
    // stays fast enough for picker rendering.
    detect: () =>
      Effect.sync(() => {
        const resolved = resolveCodexLaunch(opts?.launchOverride)
        if (!resolved) return { available: false, failureReason: 'Codex not installed' }
        return { available: true, authNeeded: false }
      }),

    spawn: (ctx) => acquire(opts, ctx, 'spawn'),
    resume: (ctx) => acquire(opts, ctx, 'resume'),
  }
}

// --- session acquire path ----------------------------------------------------

function acquire(
  opts: CodexProviderOptions | undefined,
  ctx: SpawnContext,
  phase: 'spawn' | 'resume',
): Effect.Effect<AgentSession, AgentProviderError, import('effect/Scope').Scope> {
  return Effect.gen(function* () {
    // Test path: accept a pre-opened transport so unit suites don't need
    // to spawn a real subprocess. Production path still goes through the
    // binary-resolution + spawnCodexAgent flow below.
    const spawned = opts?._testTransport
      ? {
          stdin: opts._testTransport.stdin as Writable | WritableStream<Uint8Array>,
          stdout: opts._testTransport.stdout as Readable | ReadableStream<Uint8Array>,
          stderrSnapshot: opts._testTransport.stderrSnapshot,
          __isTest: true as const,
        }
      : yield* (() => {
          const launch = resolveCodexLaunch(opts?.launchOverride)
          if (!launch) {
            return Effect.fail(
              new AgentProviderError({
                providerId: CODEX_PROVIDER_ID,
                phase,
                message: 'codex binary not found (tried @openai/codex/bin/codex.js + $PATH)',
                recoverable: false,
              }),
            )
          }
          const configuredEnv = typeof opts?.env === 'function' ? opts.env(ctx) : (opts?.env ?? {})
          const env: Record<string, string> = { ...configuredEnv }
          const key = opts?.getApiKey?.()
          if (key && key.length > 0) {
            env.OPENAI_API_KEY = key
            env.CODEX_API_KEY = key
          }
          // Keep the app-server process itself anchored in Wanda-managed
          // state. The requested project cwd is still passed to thread/start
          // below, but spawning the helper from CODEX_HOME avoids touching a
          // protected user folder merely because the subprocess launched.
          const launchCwd = typeof env.CODEX_HOME === 'string' && env.CODEX_HOME.length > 0 ? env.CODEX_HOME : ctx.cwd
          return spawnCodexAgent({
            command: launch.command,
            args: launch.args,
            cwd: launchCwd,
            env,
          }).pipe(
            Effect.map((s) => ({
              stdin: s.stdin,
              stdout: s.stdout,
              stderrSnapshot: s.stderrSnapshot,
              __isTest: false as const,
            })),
          )
        })()

    // Normalise both transport paths to Node streams. Web Streams (from
    // `spawnCodexAgent`) get wrapped; the test path already supplies Node
    // streams directly.
    const stdin = spawned.__isTest
      ? (spawned.stdin as Writable)
      : (Writable.fromWeb(spawned.stdin as never) as Writable)
    const stdout = spawned.__isTest
      ? (spawned.stdout as Readable)
      : (Readable.fromWeb(spawned.stdout as never) as Readable)

    // Runtime refs captured in the handler closures — the RPC handlers
    // are synchronous and may fire before the outer `acquire` Effect
    // finishes wiring up the session, so we refer to these via Refs.
    const turnRef = yield* Ref.make<ActiveTurn | null>(null)
    const threadIdRef = yield* Ref.make<string | null>(null)
    const isReplayingRef = yield* Ref.make<boolean>(phase === 'resume')
    // Latches to the first transport failure. Subsequent prompt() calls
    // short-circuit with this error rather than re-entering a dead channel.
    const transportFatalRef = yield* Ref.make<Error | null>(null)

    const handleTransportFailure = (err: Error): void => {
      // Latch the error so future prompts fail fast.
      const prior = Effect.runSync(Ref.get(transportFatalRef))
      if (prior) return
      const tail = safeStderrSnapshot(() => spawned.stderrSnapshot())
      const enriched = tail ? new Error(`${err.message}\n--- codex stderr (tail) ---\n${tail}`) : err
      Effect.runSync(Ref.set(transportFatalRef, enriched))

      // If a turn is in flight, reject its completion so the Effect unblocks
      // and the runtime can transition running → error.
      const turn = unsafeGet(turnRef)
      if (turn && !turn.completion.settled) {
        turn.completion.reject(enriched)
      }
    }

    const rpc: CodexRpcClient = makeCodexRpcClient({
      stdin,
      stdout,
      handlers: {
        onNotification: (method, params) => {
          handleNotification(turnRef, threadIdRef, isReplayingRef, method, params)
        },
        onRequest: (method, params) =>
          handleServerRequest(turnRef, method, params).catch((err) => {
            throw err
          }),
        onTransportError: (err) => {
          handleTransportFailure(err)
        },
      },
    })

    // --- initialize + initialized -------------------------------------------
    yield* callOrDie(
      rpc
        .request<unknown>(CODEX_METHODS.initialize, {
          clientInfo: { name: 'wanda', title: 'Wanda', version: '0.1.0' },
          capabilities: { experimentalApi: true, optOutNotificationMethods: null },
        })
        .then(validateOrThrow(InitializeResponseSchema, 'initialize')),
      CODEX_INIT_TIMEOUT_MS,
      phase,
      'initialize',
      () => spawned.stderrSnapshot(),
    )
    rpc.notify(CODEX_METHODS.initialized, {})

    // --- model/list + collaborationMode/list + account/read (best-effort) ---
    // `safeCall` collapses validation failures to `null` the same way it
    // collapses transport errors, so a malformed-but-present response
    // degrades to "no models listed" rather than aborting the session.
    const modelList = yield* safeCall<ModelListResponse>(
      rpc,
      CODEX_METHODS.modelList,
      { cursor: null, limit: 50, includeHidden: false },
      CODEX_INIT_TIMEOUT_MS,
      validateOrThrow(ModelListResponseSchema, 'model/list'),
    )
    const modeList = yield* safeCall<CollaborationModeListResponse>(
      rpc,
      CODEX_METHODS.collaborationModeList,
      {},
      CODEX_INIT_TIMEOUT_MS,
      validateOrThrow(CollaborationModeListResponseSchema, 'collaborationMode/list'),
    )
    // `account/read` fires for auth introspection — we don't branch on it
    // in v1 but do call it so the subprocess warms its auth state before
    // we open the first thread.
    yield* safeCall<AccountReadResponse>(rpc, CODEX_METHODS.accountRead, {}, CODEX_INIT_TIMEOUT_MS)

    const modelOptions = mapModelOptions(modelListEntries(modelList))
    const resolvedModelOptions = modelOptions.length > 0 ? modelOptions : CODEX_FALLBACK_MODEL_OPTIONS
    const planModeAvailable = Array.isArray(modeList?.collaborationModes)
      ? modeList!.collaborationModes.some((m) => (m.name ?? m.id ?? '').toLowerCase().includes('plan'))
      : false
    let initialModelId: ModelId | null =
      ctx.modelId ??
      (resolvedModelOptions.find((m) => m.isDefault)?.id as ModelId | undefined) ??
      (resolvedModelOptions[0]?.id as ModelId | undefined) ??
      null
    const initialModeId: ModeId = (ctx.modeId as ModeId | undefined) ?? CODEX_DEFAULT_MODE_ID

    // --- thread/start or thread/resume --------------------------------------
    const resumeHandle = ctx.resumeHandle?.variant === CODEX_HANDLE_VARIANT ? (ctx.resumeHandle as CodexHandle) : null

    const policy = codexPolicyForMode(initialModeId)

    const threadStartResponse = yield* phase === 'resume' && resumeHandle
      ? callOrDie<ThreadStartResponse>(
          rpc
            .request<unknown>(CODEX_METHODS.threadResume, {
              threadId: resumeHandle.threadId,
            })
            .then(validateOrThrow(ThreadStartResponseSchema, 'thread/resume')),
          CODEX_INIT_TIMEOUT_MS,
          phase,
          'thread/resume',
          () => spawned.stderrSnapshot(),
        )
      : callOrDie<ThreadStartResponse>(
          rpc
            .request<unknown>(CODEX_METHODS.threadStart, {
              cwd: ctx.cwd,
              approvalPolicy: policy.approvalPolicy,
              approvalsReviewer: policy.approvalsReviewer,
              sandbox: policy.sandbox,
              model: initialModelId ?? undefined,
            })
            .then(validateOrThrow(ThreadStartResponseSchema, 'thread/start')),
          CODEX_INIT_TIMEOUT_MS,
          phase,
          'thread/start',
          () => spawned.stderrSnapshot(),
        )

    const rawThreadId = threadStartResponse.thread.id
    if (typeof rawThreadId !== 'string' || rawThreadId.length === 0) {
      return yield* Effect.fail(
        new AgentProviderError({
          providerId: CODEX_PROVIDER_ID,
          phase,
          message: `${
            phase === 'resume' ? 'thread/resume' : 'thread/start'
          } did not return a usable threadId (received ${JSON.stringify(rawThreadId)}). Likely a Codex version mismatch, auth failure, or server-side error.`,
          recoverable: false,
        }),
      )
    }
    const threadId: string = rawThreadId
    if (typeof threadStartResponse.model === 'string' && threadStartResponse.model.length > 0) {
      initialModelId = threadStartResponse.model as ModelId
    }
    yield* Ref.set(threadIdRef, threadId)

    // After thread setup, resume-phase deltas from the replay can land —
    // we drop them on the floor until the first live turn starts.
    yield* Effect.sync(() => {
      // Keep isReplaying true; flip it off when the next turn begins.
    })

    // --- session-local mutable state ----------------------------------------
    let currentModeId: ModeId = initialModeId
    let currentModelId: ModelId | null = initialModelId
    let currentReasoningEffort: ReasoningEffort | null =
      ctx.reasoningEffort ??
      (currentModelId
        ? (resolvedModelOptions.find((m) => m.id === currentModelId)?.defaultReasoningEffort ?? null)
        : null)
    // Capabilities we expose: derived from the baseline + plan-mode detection.
    const capabilities: WandaCapabilities = {
      ...CODEX_BASE_CAPABILITIES,
      supportsPlanMode: planModeAvailable || CODEX_BASE_CAPABILITIES.supportsPlanMode,
      modes: [...CODEX_MODES],
      modelOptions: [...resolvedModelOptions],
    }

    // --- AgentSession shape -------------------------------------------------
    const snapshotHandle = (): CodexHandle => ({
      variant: CODEX_HANDLE_VARIANT,
      providerId: CODEX_PROVIDER_ID as unknown as string,
      threadId,
      cwd: ctx.cwd,
    })

    const prompt = (
      turnCtx: TurnContext,
      content: ReadonlyArray<PromptBlock>,
    ): Effect.Effect<{ stopReason: StopReason }, AgentProviderError> =>
      Effect.gen(function* () {
        // Fail fast if the transport already died — the subprocess is gone,
        // a new prompt would hang waiting for a turn/started that never
        // arrives. The runtime will transition running → error with this
        // message (and the stderr tail).
        const fatal = yield* Ref.get(transportFatalRef)
        if (fatal) {
          return yield* Effect.fail(
            new AgentProviderError({
              providerId: CODEX_PROVIDER_ID,
              phase: 'prompt',
              message: fatal.message,
              cause: fatal,
              recoverable: false,
            }),
          )
        }

        // First prompt clears any resume-replay guard.
        yield* Ref.set(isReplayingRef, false)

        // Build a fresh per-turn record. Codex will emit its own turnId in
        // `turn/started`; we bind the Wanda turnId to it via the handler's
        // shared turnRef when that arrives.
        const turn: ActiveTurn = {
          wandaTurnId: turnCtx.turnId,
          codexTurnId: null,
          emit: turnCtx.emit,
          sessionId: turnCtx.sessionId,
          awaitPermission: turnCtx.awaitPermission,
          buffers: makeTurnBuffers(),
          completion: deferred<{ stopReason: StopReason }>(),
          approvalReplies: new Map(),
          cancelling: false,
        }
        yield* Ref.set(turnRef, turn)

        // Wire cancellation → turn/interrupt + set cancelling flag.
        if (turnCtx.signal.aborted) {
          turn.cancelling = true
          yield* Ref.set(turnRef, null)
          return { stopReason: 'cancelled' as StopReason }
        }
        const onAbort = () => {
          turn.cancelling = true
          rpc
            .request(CODEX_METHODS.turnInterrupt, {
              threadId,
              turnId: turn.codexTurnId ?? undefined,
            })
            .catch((err) => {
              // turn/interrupt is best-effort: the subprocess may have
              // already finished or crashed. Log so a silent failure here
              // doesn't hide a broken cancel path.
              // eslint-disable-next-line no-console
              console.error('[codex-provider] turn/interrupt failed', {
                threadId,
                err: err instanceof Error ? err.message : String(err),
              })
            })
        }
        turnCtx.signal.addEventListener('abort', onAbort, { once: true })

        const turnPolicy = codexPolicyForMode(currentModeId)
        const turnSandbox = codexTurnSandboxPolicy(currentModeId)

        const codexInput = promptToCodexInput(content, opts?.resolveAttachmentPath)
        const startTurn = (modelId: ModelId | null) =>
          rpc.request<TurnStartResponse>(CODEX_METHODS.turnStart, {
            threadId,
            input: codexInput,
            approvalPolicy: turnPolicy.approvalPolicy,
            approvalsReviewer: turnPolicy.approvalsReviewer,
            sandboxPolicy: turnSandbox,
            model: modelId ?? undefined,
            effort: currentReasoningEffort ?? undefined,
            cwd: ctx.cwd,
          })

        try {
          const started = yield* Effect.tryPromise({
            try: async () => {
              try {
                return await startTurn(currentModelId)
              } catch (err) {
                const fallback = fallbackModelAfterCodexCompatibilityError(err, currentModelId, resolvedModelOptions)
                if (!fallback) throw err
                currentModelId = fallback
                return await startTurn(currentModelId)
              }
            },
            catch: (err) =>
              new AgentProviderError({
                providerId: CODEX_PROVIDER_ID,
                phase: 'prompt',
                message: err instanceof Error ? err.message : String(err),
                cause: err,
                recoverable: true,
              }),
          })
          // Store Codex's turn id for cross-notification correlation.
          // Codex 0.104 shape: `{ turn: { id, status, items } }`. Fall
          // back to a flat `turnId` for older builds, but don't fail the
          // prompt if neither is present — the turn/started notification
          // will bind it when it arrives.
          turn.codexTurnId =
            (started as { turn?: { id?: string } }).turn?.id ?? (started as { turnId?: string }).turnId ?? null

          // Emit turn.started now (the runtime does this itself based on
          // prompt return, but we own turnId binding here so we avoid a
          // race with first-notification arrival).
          // Note: runtime already emits `turn.started` based on its own
          // turnId — we emit nothing here; notifications flow through the
          // handler.

          // Wait on either turn/completed notification or the cancel chain.
          const outcome = yield* Effect.tryPromise({
            try: () => turn.completion.promise,
            catch: (err) =>
              new AgentProviderError({
                providerId: CODEX_PROVIDER_ID,
                phase: 'prompt',
                message: err instanceof Error ? err.message : String(err),
                cause: err,
                recoverable: true,
              }),
          })
          return outcome
        } finally {
          turnCtx.signal.removeEventListener('abort', onAbort)
          yield* Ref.set(turnRef, null)
        }
      })

    const setMode = (modeId: ModeId): Effect.Effect<void, AgentProviderError> =>
      Effect.sync(() => {
        if (!CODEX_MODES.some((m) => m.id === modeId)) {
          throw new AgentProviderError({
            providerId: CODEX_PROVIDER_ID,
            phase: 'setMode',
            message: `Mode ${String(modeId)} not advertised`,
            recoverable: true,
          })
        }
        currentModeId = modeId
      }).pipe(
        Effect.catchAllDefect((defect) =>
          defect instanceof AgentProviderError
            ? Effect.fail(defect)
            : Effect.fail(
                new AgentProviderError({
                  providerId: CODEX_PROVIDER_ID,
                  phase: 'setMode',
                  message: defect instanceof Error ? defect.message : String(defect),
                  recoverable: true,
                }),
              ),
        ),
      )

    const setModel = (modelId: ModelId): Effect.Effect<void, AgentProviderError> =>
      Effect.sync(() => {
        if (!resolvedModelOptions.some((m) => m.id === modelId)) {
          throw new AgentProviderError({
            providerId: CODEX_PROVIDER_ID,
            phase: 'setModel',
            message: `Model ${String(modelId)} not advertised`,
            recoverable: true,
          })
        }
        currentModelId = modelId
        const selected = resolvedModelOptions.find((m) => m.id === modelId)
        if (
          currentReasoningEffort != null &&
          selected?.supportedReasoningEfforts &&
          !selected.supportedReasoningEfforts.includes(currentReasoningEffort)
        ) {
          currentReasoningEffort = selected.defaultReasoningEffort ?? null
        }
      }).pipe(
        Effect.catchAllDefect((defect) =>
          defect instanceof AgentProviderError
            ? Effect.fail(defect)
            : Effect.fail(
                new AgentProviderError({
                  providerId: CODEX_PROVIDER_ID,
                  phase: 'setModel',
                  message: defect instanceof Error ? defect.message : String(defect),
                  recoverable: true,
                }),
              ),
        ),
      )

    const setReasoningEffort = (effort: ReasoningEffort): Effect.Effect<void, AgentProviderError> =>
      Effect.sync(() => {
        const selected = currentModelId ? resolvedModelOptions.find((m) => m.id === currentModelId) : undefined
        const allowed = selected?.supportedReasoningEfforts
        if (allowed && allowed.length > 0 && !allowed.includes(effort)) {
          throw new AgentProviderError({
            providerId: CODEX_PROVIDER_ID,
            phase: 'setModel',
            message: `Reasoning effort ${effort} not supported by ${String(currentModelId)}`,
            recoverable: true,
          })
        }
        currentReasoningEffort = effort
      }).pipe(
        Effect.catchAllDefect((defect) =>
          defect instanceof AgentProviderError
            ? Effect.fail(defect)
            : Effect.fail(
                new AgentProviderError({
                  providerId: CODEX_PROVIDER_ID,
                  phase: 'setModel',
                  message: defect instanceof Error ? defect.message : String(defect),
                  recoverable: true,
                }),
              ),
        ),
      )

    // Scope cleanup — cascade SIGTERM is handled by spawnCodexAgent's release;
    // we only need to close the RPC client so pending callers get rejected.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        try {
          rpc.close('session scope closed')
        } catch {
          /* ignore */
        }
      }),
    )

    // Codex's `review/start` runs as a turn on the current thread, so the
    // provider-side bookkeeping is nearly identical to `prompt`: register
    // an ActiveTurn so notifications route to the TurnContext, fire the
    // RPC, and wait on `turn.completion`. The only difference from
    // `prompt` is the kick-off RPC — every item / text / tool / turn
    // notification flows through the same mapper path.
    const startReview = (
      turnCtx: TurnContext,
      target: import('@wanda/agent-protocol').ReviewTarget,
    ): Effect.Effect<{ stopReason: StopReason }, AgentProviderError> =>
      Effect.gen(function* () {
        const fatal = yield* Ref.get(transportFatalRef)
        if (fatal) {
          return yield* Effect.fail(
            new AgentProviderError({
              providerId: CODEX_PROVIDER_ID,
              phase: 'prompt',
              message: fatal.message,
              cause: fatal,
              recoverable: false,
            }),
          )
        }
        yield* Ref.set(isReplayingRef, false)

        const turn: ActiveTurn = {
          wandaTurnId: turnCtx.turnId,
          codexTurnId: null,
          emit: turnCtx.emit,
          sessionId: turnCtx.sessionId,
          awaitPermission: turnCtx.awaitPermission,
          buffers: makeTurnBuffers(),
          completion: deferred<{ stopReason: StopReason }>(),
          approvalReplies: new Map(),
          cancelling: false,
        }
        yield* Ref.set(turnRef, turn)

        if (turnCtx.signal.aborted) {
          turn.cancelling = true
          yield* Ref.set(turnRef, null)
          return { stopReason: 'cancelled' as StopReason }
        }
        const onAbort = () => {
          turn.cancelling = true
          rpc
            .request(CODEX_METHODS.turnInterrupt, {
              threadId,
              turnId: turn.codexTurnId ?? undefined,
            })
            .catch((err) => {
              // eslint-disable-next-line no-console
              console.error('[codex-provider] turn/interrupt (review) failed', {
                threadId,
                err: err instanceof Error ? err.message : String(err),
              })
            })
        }
        turnCtx.signal.addEventListener('abort', onAbort, { once: true })

        const startPromise = rpc.request<unknown>(CODEX_METHODS.reviewStart, {
          threadId,
          target,
          delivery: 'inline',
        })

        try {
          yield* Effect.tryPromise({
            try: () => startPromise,
            catch: (err) =>
              new AgentProviderError({
                providerId: CODEX_PROVIDER_ID,
                phase: 'prompt',
                message: err instanceof Error ? err.message : String(err),
                cause: err,
                recoverable: true,
              }),
          })
          const outcome = yield* Effect.tryPromise({
            try: () => turn.completion.promise,
            catch: (err) =>
              new AgentProviderError({
                providerId: CODEX_PROVIDER_ID,
                phase: 'prompt',
                message: err instanceof Error ? err.message : String(err),
                cause: err,
                recoverable: true,
              }),
          })
          return outcome
        } finally {
          turnCtx.signal.removeEventListener('abort', onAbort)
          yield* Ref.set(turnRef, null)
        }
      })

    const session: AgentSession = {
      capabilities,
      modes: CODEX_MODES,
      modelOptions: resolvedModelOptions,
      currentModeId,
      currentModelId,
      currentReasoningEffort,
      persistenceHandle: snapshotHandle(),
      prompt,
      setMode,
      setModel,
      setReasoningEffort,
      startReview,
      stderrSnapshot: () => spawned.stderrSnapshot(),
      snapshotHandle,
    }
    return session
  })
}

// --- notification + request dispatch -----------------------------------------

interface ActiveTurn {
  wandaTurnId: TurnId
  codexTurnId: string | null
  readonly sessionId: SessionId
  readonly emit: import('@wanda/agent-runtime').ProviderEmit
  readonly awaitPermission: TurnContext['awaitPermission']
  readonly buffers: ReturnType<typeof makeTurnBuffers>
  readonly completion: Deferred<{ stopReason: StopReason }>
  readonly approvalReplies: Map<string, ToolCallId>
  cancelling: boolean
}

// Replay-phase drop counter (keyed by method). Held at module scope so we
// can log once per method per resume — otherwise a replay with thousands
// of deltas would spam stderr. Cleared opportunistically in the prompt
// handler when isReplayingRef flips to false.
const replayDropCounts: Map<string, number> = new Map()

function handleNotification(
  turnRef: Ref.Ref<ActiveTurn | null>,
  threadIdRef: Ref.Ref<string | null>,
  isReplayingRef: Ref.Ref<boolean>,
  method: string,
  params: unknown,
): void {
  const turn = unsafeGet(turnRef)
  const activeThreadId = unsafeGet(threadIdRef)
  const replaying = unsafeGet(isReplayingRef)
  if (replaying) {
    // We drop replay-phase notifications on the floor — the Wanda event
    // log is the source of truth for past turns, and we have no ActiveTurn
    // to emit into. But we surface `error` notifications (subprocess
    // reports a fatal condition) and log first-sighting drops for other
    // methods so silent drops become diagnosable.
    if (method === CODEX_SERVER_NOTIFICATIONS.error) {
      // eslint-disable-next-line no-console
      console.error('[codex-provider] error during resume replay:', params)
      return
    }
    const prior = replayDropCounts.get(method) ?? 0
    replayDropCounts.set(method, prior + 1)
    if (prior === 0 && typeof process !== 'undefined' && process.env?.WANDA_CODEX_DEBUG) {
      // eslint-disable-next-line no-console
      console.error(`[codex-provider] replay-drop ${method} (further drops for this method silenced)`)
    }
    return
  }
  if (!turn) return
  if (!notificationMatchesThread(activeThreadId, params)) return

  const ctx: CodexTurnContext = {
    sessionId: turn.sessionId,
    turnId: turn.wandaTurnId,
    emit: turn.emit,
  }
  logCodexNotification(method, params)

  switch (method) {
    case CODEX_SERVER_NOTIFICATIONS.turnStarted: {
      const note = params as TurnStartedNotification
      const startedTurnId = note.turn?.id ?? note.turnId ?? null
      if (turn.codexTurnId && startedTurnId && startedTurnId !== turn.codexTurnId) return
      turn.codexTurnId = startedTurnId
      return
    }
    case CODEX_SERVER_NOTIFICATIONS.modelRerouted: {
      const note = params as { turnId?: string; toModel?: string }
      if (turn.codexTurnId && note.turnId && note.turnId !== turn.codexTurnId) return
      if (typeof note.toModel !== 'string' || note.toModel.length === 0) return
      turn.emit({
        kind: 'model.changed',
        sessionId: turn.sessionId,
        modelId: note.toModel as ModelId,
      })
      return
    }
    case CODEX_SERVER_NOTIFICATIONS.turnCompleted: {
      const note = params as TurnCompletedNotification
      const completedTurnId = note.turn?.id
      if (typeof completedTurnId !== 'string' || completedTurnId.length === 0) return
      if (turn.codexTurnId && completedTurnId !== turn.codexTurnId) return
      turn.codexTurnId = completedTurnId
      // Codex 0.104 nests status under `turn`. Fall back to the flat
      // top-level shape in case we ever talk to an older server — the
      // mapper does the same. See protocol.ts TurnCompletedNotification.
      const flat = note as unknown as { status?: unknown; stopReason?: unknown }
      const status: string =
        (note.turn && typeof note.turn.status === 'string' && note.turn.status) ||
        (typeof flat.status === 'string' ? flat.status : '')
      if (status === 'failed') {
        rejectTurn(
          turn,
          new AgentProviderError({
            providerId: CODEX_PROVIDER_ID,
            phase: 'prompt',
            message: note.turn.error?.message ?? 'Codex turn failed',
            cause: note,
            recoverable: true,
          }),
        )
        return
      }
      if (status === 'interrupted' || status === 'canceled') {
        if (turn.cancelling) return
        rejectTurn(
          turn,
          new AgentProviderError({
            providerId: CODEX_PROVIDER_ID,
            phase: 'prompt',
            message: 'Codex turn cancelled',
            cause: note,
            recoverable: true,
          }),
        )
        return
      }
      const stopReason: StopReason = flat.stopReason === 'max_tokens' ? 'max_tokens' : 'end_turn'
      onTurnCompletedItems(ctx, turn.buffers, note)
      resolveTurn(turn, { stopReason })
      return
    }
    case CODEX_SERVER_NOTIFICATIONS.itemStarted: {
      const note = params as ItemStartedNotification
      if (!notificationMatchesTurn(turn, note.turnId)) return
      onItemStarted(ctx, turn.buffers, note)
      return
    }
    case CODEX_SERVER_NOTIFICATIONS.itemCompleted: {
      const note = params as ItemCompletedNotification
      if (!notificationMatchesTurn(turn, note.turnId)) return
      onItemCompleted(ctx, turn.buffers, note)
      return
    }
    case CODEX_SERVER_NOTIFICATIONS.rawResponseItemCompleted: {
      const note = params as RawResponseItemCompletedNotification
      if (!notificationMatchesTurn(turn, note.turnId)) return
      onRawResponseItemCompleted(ctx, turn.buffers, note)
      return
    }
    case CODEX_SERVER_NOTIFICATIONS.agentMessageDelta: {
      const note = params as ItemDeltaNotification
      if (!notificationMatchesTurn(turn, note.turnId)) return
      onAgentMessageDelta(ctx, turn.buffers, note)
      return
    }
    case CODEX_SERVER_NOTIFICATIONS.reasoningTextDelta: {
      const note = params as ItemDeltaNotification
      if (!notificationMatchesTurn(turn, note.turnId)) return
      onReasoningDelta(ctx, turn.buffers, note)
      return
    }
    case CODEX_SERVER_NOTIFICATIONS.commandExecOutputDelta: {
      const note = params as CommandExecOutputDeltaNotification
      if (!notificationMatchesTurn(turn, note.turnId)) return
      onCommandExecOutputDelta(ctx, turn.buffers, note)
      return
    }
    case CODEX_SERVER_NOTIFICATIONS.planUpdated: {
      const note = params as PlanUpdatedNotification
      if (!notificationMatchesTurn(turn, note.turnId)) return
      onPlanUpdated(ctx, note)
      return
    }
    case CODEX_SERVER_NOTIFICATIONS.error:
      if (!notificationMatchesTurn(turn, (params as ErrorNotification).turnId)) return
      if (isCodexModelRequiresNewerVersionError(params)) return
      onError(ctx, params as ErrorNotification)
      return
    default:
      // Silent: the v1 notification surface intentionally ignores many
      // Codex signals (thread/status/changed, rawResponseItem/completed,
      // account/rateLimits/updated, etc.). We log once at the server
      // level — not here — to keep this dispatch free of side effects.
      return
  }
}

function notificationMatchesThread(activeThreadId: string | null, params: unknown): boolean {
  if (!activeThreadId) return true
  if (!params || typeof params !== 'object') return true
  const threadId = (params as { threadId?: unknown }).threadId
  return typeof threadId !== 'string' || threadId === activeThreadId
}

function notificationMatchesTurn(turn: ActiveTurn, turnId: unknown): boolean {
  if (typeof turnId !== 'string' || turnId.length === 0) return true
  return turn.codexTurnId == null || turn.codexTurnId === turnId
}

function logCodexNotification(method: string, params: unknown): void {
  if (typeof process === 'undefined' || !process.env?.WANDA_CODEX_DEBUG) return
  switch (method) {
    case CODEX_SERVER_NOTIFICATIONS.turnStarted:
    case CODEX_SERVER_NOTIFICATIONS.turnCompleted:
    case CODEX_SERVER_NOTIFICATIONS.itemStarted:
    case CODEX_SERVER_NOTIFICATIONS.itemCompleted:
    case CODEX_SERVER_NOTIFICATIONS.rawResponseItemCompleted:
    case CODEX_SERVER_NOTIFICATIONS.agentMessageDelta:
    case CODEX_SERVER_NOTIFICATIONS.reasoningTextDelta:
    case CODEX_SERVER_NOTIFICATIONS.commandExecOutputDelta:
      break
    default:
      return
  }
  process.stderr.write(`[codex-provider] notification ${JSON.stringify(summarizeCodexNotification(method, params))}\n`)
}

function summarizeCodexNotification(method: string, params: unknown): Record<string, unknown> {
  const p = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
  const item = p.item && typeof p.item === 'object' ? (p.item as Record<string, unknown>) : null
  const turn = p.turn && typeof p.turn === 'object' ? (p.turn as Record<string, unknown>) : null
  const rawContent = item && Array.isArray(item.content) ? item.content : null
  return {
    method,
    threadId: p.threadId,
    turnId: p.turnId ?? turn?.id,
    itemId: p.itemId ?? item?.id,
    itemType: item?.type,
    itemTextLength: typeof item?.text === 'string' ? item.text.length : undefined,
    rawContentTypes: rawContent?.map((part) =>
      part && typeof part === 'object' ? (part as { type?: unknown }).type : typeof part,
    ),
    deltaLength: typeof p.delta === 'string' ? p.delta.length : undefined,
    turnStatus: turn?.status,
    turnItemTypes: Array.isArray(turn?.items)
      ? turn.items.map((entry) =>
          entry && typeof entry === 'object' ? (entry as { type?: unknown }).type : typeof entry,
        )
      : undefined,
  }
}

function resolveTurn(turn: ActiveTurn, value: { stopReason: StopReason }): void {
  if (!turn.completion.settled) {
    turn.completion.resolve(value)
  }
}

function rejectTurn(turn: ActiveTurn, error: AgentProviderError): void {
  if (!turn.completion.settled) {
    turn.completion.reject(error)
  }
}

async function handleServerRequest(
  turnRef: Ref.Ref<ActiveTurn | null>,
  method: string,
  params: unknown,
): Promise<unknown> {
  const turn = unsafeGet(turnRef)
  if (!turn) {
    // No active turn — the only sane reply is decline so Codex can abort.
    return { decision: 'cancel' }
  }
  switch (method) {
    case CODEX_SERVER_REQUESTS.commandExecApproval:
    case CODEX_SERVER_REQUESTS.legacyExecCommandApproval:
      return handleApproval(turn, 'shell', params as RequestApprovalParams)
    case CODEX_SERVER_REQUESTS.fileChangeApproval:
    case CODEX_SERVER_REQUESTS.legacyApplyPatchApproval:
      return handleApproval(turn, 'diff', params as RequestApprovalParams)
    case CODEX_SERVER_REQUESTS.userInput:
    case CODEX_SERVER_REQUESTS.legacyUserInput:
      // v1 punt: no user-input UI yet. Cancel cleanly.
      return { answers: {}, cancelled: true }
    default:
      return { decision: 'cancel' }
  }
}

async function handleApproval(
  turn: ActiveTurn,
  kind: 'shell' | 'diff',
  params: RequestApprovalParams,
): Promise<unknown> {
  const built = buildApprovalPermissionRequest(kind, params)
  const requestId = newRequestId()
  const toolCallId =
    typeof params.itemId === 'string' ? (params.itemId as unknown as ToolCallId) : (requestId as unknown as ToolCallId)
  const request: PermissionRequest = {
    kind: 'tool',
    toolCallId,
    title: built.title,
    detail: built.detail,
    actions: [...built.actions],
  }
  try {
    const decision: Decision = await turn.awaitPermission(request)
    return { decision: decisionToCodexApproval(decision) }
  } catch (err) {
    // awaitPermission rejects on turn cancel / timeout / runtime error.
    // We always fall back to `cancel` so Codex unblocks the tool call,
    // but log the reason so a masked failure (e.g. a thrown defect from
    // the permission store) doesn't disappear into a silent deny.
    // eslint-disable-next-line no-console
    console.error('[codex-provider] awaitPermission rejected; replying cancel', {
      itemId: params.itemId,
      err: err instanceof Error ? err.message : String(err),
    })
    return { decision: 'cancel' }
  }
}

// --- helpers ------------------------------------------------------------------

function promptToCodexInput(
  content: ReadonlyArray<PromptBlock>,
  resolveAttachmentPath?: CodexProviderOptions['resolveAttachmentPath'],
): ReadonlyArray<{ type: 'text'; text: string } | { type: 'localImage'; path: string; mimeType?: string }> {
  const out: Array<{ type: 'text'; text: string } | { type: 'localImage'; path: string; mimeType?: string }> = []
  const texts: string[] = []
  for (const block of content) {
    if (block.kind === 'text' && block.text.length > 0) {
      texts.push(block.text)
    } else if (block.kind === 'mention') {
      texts.push(`@${block.label}`)
    } else if (block.kind === 'command') {
      texts.push(`/${block.name}`)
    } else if (block.kind === 'image') {
      const resolved = resolveAttachmentPath?.({
        id: block.id as unknown as string,
        sha256: block.sha256,
        mediaType: block.mediaType,
        name: block.name,
      })
      if (resolved) {
        out.push({ type: 'localImage', path: resolved, mimeType: block.mediaType })
      } else {
        // Fall back to a visible placeholder so the user sees *something*
        // rather than the block silently disappearing. Better than failing
        // the whole turn for an unresolved image.
        texts.push(`[image:${block.name ?? block.id}]`)
      }
    } else if (block.kind === 'attachment') {
      // Non-image attachments: Codex has no generic file-attach block in
      // turn/start, so we always fall back to a placeholder line.
      texts.push(`[attachment:${block.name ?? block.id}]`)
    } else if (block.kind === 'resource') {
      texts.push(`[${block.title ?? block.ref.id}]`)
    }
  }
  const joined = texts.join('\n').trim()
  if (joined.length > 0) out.unshift({ type: 'text', text: joined })
  if (out.length === 0) out.push({ type: 'text', text: '' })
  return out
}

function mapModelOptions(
  entries: ReadonlyArray<{
    id: string
    model?: string
    displayName?: string
    description?: string
    hidden?: boolean
    inputModalities?: ReadonlyArray<string>
    isDefault?: boolean
    supportedReasoningEfforts?: ReadonlyArray<string | { readonly reasoningEffort?: string }>
    defaultReasoningEffort?: string
  }>,
): ReadonlyArray<ModelOption> {
  return entries
    .filter((e) => e.hidden !== true)
    .map((e) => {
      const id = e.id || e.model || ''
      return {
        id: id as unknown as ModelId,
        label: normalizeCodexModelLabel(e.displayName) ?? normalizeCodexModelLabel(id) ?? id,
        description: e.description,
        supportsReasoning: (e.supportedReasoningEfforts?.length ?? 0) > 0,
        supportedReasoningEfforts: normalizeReasoningEfforts(e.supportedReasoningEfforts),
        defaultReasoningEffort: normalizeReasoningEffort(e.defaultReasoningEffort),
        supportsImages: e.inputModalities?.includes('image') ?? false,
        isDefault: e.isDefault ?? false,
      }
    })
    .filter((m) => m.id.length > 0)
}

function modelListEntries(modelList: ModelListResponse | null | undefined): ReadonlyArray<CodexModelEntry> {
  return modelList?.data ?? modelList?.models ?? []
}

function normalizeReasoningEfforts(
  efforts: ReadonlyArray<string | { readonly reasoningEffort?: string }> | undefined,
): ReasoningEffort[] | undefined {
  const out = (efforts ?? [])
    .map((effort) => normalizeReasoningEffort(typeof effort === 'string' ? effort : effort.reasoningEffort))
    .filter((effort): effort is ReasoningEffort => effort != null)
  return out.length > 0 ? [...new Set(out)] : undefined
}

function normalizeReasoningEffort(effort: string | undefined): ReasoningEffort | undefined {
  switch (effort?.toLowerCase()) {
    case 'none':
    case 'disabled':
      return 'none'
    case 'minimal':
      return 'minimal'
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
      return 'high'
    case 'xhigh':
    case 'extra-high':
    case 'extra_high':
      return 'xhigh'
    case 'max':
      return 'max'
    default:
      return undefined
  }
}

function fallbackModelAfterCodexCompatibilityError(
  err: unknown,
  rejectedModelId: ModelId | null,
  modelOptions: ReadonlyArray<ModelOption>,
): ModelId | null {
  if (!rejectedModelId || !isCodexModelRequiresNewerVersionError(err)) return null
  return modelOptions.find((m) => m.id !== rejectedModelId)?.id ?? null
}

function isCodexModelRequiresNewerVersionError(value: unknown): boolean {
  return stringifyUnknown(value).includes('requires a newer version of Codex')
}

function stringifyUnknown(value: unknown): string {
  if (value instanceof Error) return `${value.message}\n${value.stack ?? ''}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function callOrDie<T>(
  promise: Promise<T>,
  timeoutMs: number,
  phase: 'spawn' | 'resume' | 'prompt',
  label: string,
  getStderr?: () => string | undefined | null,
): Effect.Effect<T, AgentProviderError> {
  return Effect.tryPromise({
    try: () =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]),
    catch: (err) => {
      const tail = getStderr ? safeStderrSnapshot(getStderr) : null
      const detail = err instanceof Error ? err.message : String(err)
      return new AgentProviderError({
        providerId: CODEX_PROVIDER_ID,
        phase,
        message: `${label} failed: ${detail}${tail ? `\n--- codex stderr (tail) ---\n${tail}` : ''}`,
        cause: err,
        recoverable: false,
      })
    },
  })
}

/**
 * Best-effort RPC call used during the init handshake: failure is logged
 * (via the caller's fail-safe) and collapses to `null` rather than
 * aborting the whole session. Older Codex builds may lack
 * `collaborationMode/list` or `account/read` — those shouldn't block the
 * happy path. The optional `transform` runs after a successful response,
 * so callers can thread Zod validation through without changing the
 * collapse-to-null semantics.
 */
function safeCall<T>(
  rpc: CodexRpcClient,
  method: string,
  params: unknown,
  timeoutMs: number,
  transform?: (raw: unknown) => T,
): Effect.Effect<T | null, never> {
  return Effect.tryPromise({
    try: () =>
      Promise.race([
        transform
          ? rpc.request<unknown>(method, params).then(transform)
          : (rpc.request<T>(method, params) as Promise<T>),
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs)),
      ]),
    catch: (err) => err,
  }).pipe(Effect.orElseSucceed(() => null as T | null))
}

/**
 * Build a `.then(...)` transformer that validates an RPC response against
 * a Zod schema. On drift, throws a plain `Error` whose message captures
 * the first Zod issue; `callOrDie` / `safeCall` wrap this into an
 * `AgentProviderError` or collapse to `null` respectively.
 *
 * This is the light-weight stand-in for a full openai/codex schema codegen
 * pipeline (t3 gold-standard). We validate only the handful of responses
 * whose fields we read — everything else passes through unchecked.
 */
function validateOrThrow<T extends z.ZodTypeAny>(schema: T, label: string): (raw: unknown) => z.infer<T> {
  return (raw) => {
    const result = schema.safeParse(raw)
    if (!result.success) {
      const firstIssue = result.error.issues[0]
      const path = firstIssue?.path.join('.') || '(root)'
      throw new Error(`${label}: response shape mismatch at '${path}' — ${firstIssue?.message ?? 'unknown error'}`)
    }
    return result.data
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: Error) => void
  /** True once resolve/reject has been called. Prevents double-settling. */
  settled: boolean
}

function deferred<T>(): Deferred<T> {
  let resolveFn: (value: T) => void = () => undefined
  let rejectFn: (err: Error) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res
    rejectFn = rej
  })
  const d: Deferred<T> = {
    promise,
    settled: false,
    resolve: (value) => {
      if (d.settled) return
      d.settled = true
      resolveFn(value)
    },
    reject: (err) => {
      if (d.settled) return
      d.settled = true
      rejectFn(err)
    },
  }
  return d
}

function safeStderrSnapshot(get: () => string | undefined | null): string | null {
  try {
    const snap = get()
    if (!snap) return null
    // Trim to the last ~2 KiB — enough to show the last Codex panic/error
    // without flooding logs with boot-time chatter.
    return snap.length > 2048 ? snap.slice(-2048) : snap
  } catch (err) {
    // This is a diagnostic helper. If it itself throws that's a bug —
    // log it so we don't paper over the missing tail with a blank field.
    // eslint-disable-next-line no-console
    console.error(
      '[codex-provider] stderrSnapshot threw while capturing error tail',
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

// --- unsafe sync Ref read ----------------------------------------------------
// The RPC handlers are synchronous callbacks from the Node stream; they can't
// yield through `Effect.runSync` without re-entering the runtime, and the Ref
// is only mutated in controlled Effect contexts. Reading the raw value
// synchronously is safe here.

function unsafeGet<T>(ref: Ref.Ref<T>): T {
  // Effect Ref.Ref<T> stores its value as the result of `Effect.runSync(Ref.get)`.
  // We bypass by casting — the Ref implementation exposes a synchronous `unsafeGet`
  // internally, but it's not public. Use the public runSync path, which is
  // cheap for a memory-backed Ref.
  return Effect.runSync(Ref.get(ref))
}

// --- binary resolution --------------------------------------------------------

function resolveCodexLaunch(
  override: { command: string; args: ReadonlyArray<string> } | undefined,
): { command: string; args: ReadonlyArray<string> } | null {
  if (override) return { command: override.command, args: [...override.args] }

  // Prefer the npm-bundled launcher so we know which version we target.
  // `createRequire` scopes the resolution to this package's node_modules tree.
  try {
    const require = createRequire(import.meta.url)
    const resolvedPath = require.resolve('@openai/codex/bin/codex.js')
    return { command: process.execPath, args: [resolvedPath, 'app-server'] }
  } catch {
    /* fall through */
  }

  // Fall back to PATH. spawn() will ENOENT if neither is installed.
  return { command: 'codex', args: ['app-server'] }
}
