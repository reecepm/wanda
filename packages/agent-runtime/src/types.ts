// -----------------------------------------------------------------------------
// Public types for @wanda/agent-runtime.
//
// `AgentProvider` is the contract every provider (mock, ACP, Claude SDK,
// Codex) implements. Providers live outside this package; their contract
// is owned here so the runtime can drive them uniformly.
// -----------------------------------------------------------------------------

import type {
  AgentCapabilities,
  AgentEvent,
  AgentMode,
  Decision,
  ModeId,
  ModelId,
  ModelOption,
  PermissionRequest,
  PromptBlock,
  ProviderId,
  QuestionAnswer,
  ReasoningEffort,
  ReviewTarget,
  SessionId,
  StopReason,
  TurnId,
} from '@wanda/agent-protocol'
import type * as Effect from 'effect/Effect'
import type * as Scope from 'effect/Scope'
import type { AgentProviderError } from './errors.ts'

/** Environment capabilities exposed to `provider.detect()`. */
export interface ProviderEnv {
  readonly platform: 'node' | 'electron' | 'browser'
  readonly isSubprocess: boolean
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly userDataDir: string
}

export interface ProviderManifest {
  readonly id: ProviderId
  readonly label: string
  readonly description?: string
  readonly kind: 'sdk-in-process' | 'subprocess-stdio' | 'acp-native' | 'mock'
  readonly staticCapabilities: {
    readonly supportsSessionResume: boolean
    readonly supportsMcpServers: boolean
    readonly requiresApiKey: boolean
    readonly requiresLogin: boolean
    readonly desktopOnly: boolean
  }
  readonly docsUrl?: string
}

/**
 * Opaque per-provider resume handle. Serialised into
 * `chat_sessions.persistence_handle` and returned to providers on resume.
 * Provider-defined `variant` lets multiple providers coexist in one DB.
 */
export type PersistenceHandle = { readonly variant: string; readonly [k: string]: unknown }

export interface SpawnContext {
  readonly sessionId: SessionId
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly workspaceId: string | null
  /** Present on the resume path. */
  readonly resumeHandle?: PersistenceHandle
  readonly modeId?: ModeId
  readonly modelId?: ModelId
  readonly reasoningEffort?: ReasoningEffort
  /** MCP servers for providers that support it. Type-opaque to keep this isomorphic. */
  readonly mcpServers?: ReadonlyArray<unknown>
}

/**
 * Synchronous, non-Effect, FIFO emit handed to the provider's `prompt()`.
 * The runtime handles coalescing, live/persist split (04 §4), and
 * backpressure — the provider just calls `emit(event)`.
 */
export type ProviderEmit = (event: AgentEvent) => void

/**
 * Per-turn context. The `awaitPermission` / `awaitQuestion` bridges convert
 * the runtime's internal `Deferred`s to Promises so SDK-driven providers can
 * `await` them from their own async machinery.
 */
export interface TurnContext {
  readonly sessionId: SessionId
  readonly turnId: TurnId
  readonly emit: ProviderEmit
  readonly awaitPermission: (request: PermissionRequest, timeoutMs?: number) => Promise<Decision>
  readonly awaitQuestion: (
    questionId: string,
    prompt: string,
    options?: ReadonlyArray<{ id: string; label: string; description?: string }>,
  ) => Promise<QuestionAnswer>
  readonly signal: AbortSignal
}

export interface AgentSession {
  readonly capabilities: AgentCapabilities
  readonly modes: ReadonlyArray<AgentMode>
  readonly modelOptions: ReadonlyArray<ModelOption>
  readonly currentModeId: ModeId | null
  readonly currentModelId: ModelId | null
  readonly currentReasoningEffort: ReasoningEffort | null
  readonly persistenceHandle: PersistenceHandle

  readonly prompt: (
    ctx: TurnContext,
    content: ReadonlyArray<PromptBlock>,
  ) => Effect.Effect<{ stopReason: StopReason }, AgentProviderError>

  readonly setMode: (modeId: ModeId) => Effect.Effect<void, AgentProviderError>
  readonly setModel: (modelId: ModelId) => Effect.Effect<void, AgentProviderError>
  readonly setReasoningEffort: (effort: ReasoningEffort) => Effect.Effect<void, AgentProviderError>

  /**
   * Kick off a provider-native code review. Optional — only providers
   * whose `capabilities.supportsReview` is true should expose this. The
   * review runs as a turn on the existing session and MUST drive the
   * same per-turn lifecycle as `prompt`: use `ctx.emit` for item /
   * text / tool events and resolve with a `StopReason` when the turn
   * ends. The runtime forks this through `runTurn` exactly like a
   * prompt, so cancellation, permission prompts and turn.completed
   * events all route correctly.
   */
  readonly startReview?: (
    ctx: TurnContext,
    target: ReviewTarget,
  ) => Effect.Effect<{ stopReason: StopReason }, AgentProviderError>

  /** Snapshot of the stderr ring buffer for the diagnostic view. Sync, non-Effect. */
  readonly stderrSnapshot: () => string

  /**
   * Sync snapshot of the current persistence handle. The runtime calls this
   * after each turn + on close to flush the handle to durable storage;
   * providers that mutate transcript / thread state should return a fresh
   * object each call. Defaults to `persistenceHandle` when omitted.
   */
  readonly snapshotHandle?: () => PersistenceHandle
}

export interface DetectResult {
  readonly available: boolean
  readonly version?: string
  readonly authNeeded?: boolean
  readonly failureReason?: string
}

export interface AgentProvider {
  readonly manifest: ProviderManifest

  /**
   * Cheap, idempotent environment probe. Runs at boot and on user-triggered
   * refresh. Must never throw.
   */
  readonly detect: (env: ProviderEnv) => Effect.Effect<DetectResult>

  /**
   * Acquire the provider for a new session. MUST register release on the
   * passed Scope — the runtime cascades scope close on session end / eviction.
   */
  readonly spawn: (ctx: SpawnContext) => Effect.Effect<AgentSession, AgentProviderError, Scope.Scope>

  /**
   * Resume a previously-evicted session. Only called when
   * `manifest.staticCapabilities.supportsSessionResume === true`. Providers
   * without resume may omit this; the runtime falls back to `spawn`.
   */
  readonly resume?: (ctx: SpawnContext) => Effect.Effect<AgentSession, AgentProviderError, Scope.Scope>
}

/** Opaque handle returned from the runtime's `attach()` — used by subscribers to seed their cursor. */
export interface AgentSessionHandle {
  readonly sessionId: SessionId
  readonly epoch: number
  readonly snapshotSeq: number
}
