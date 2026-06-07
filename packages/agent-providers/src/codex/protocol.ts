// -----------------------------------------------------------------------------
// Codex app-server method + notification shapes used by the v1 provider.
//
// Hand-written (not generated). Only covers what the text-and-basic-tools
// v1 adapter actually calls or dispatches on. When we graduate to the full
// generated-schema pipeline (spec 07 §12.3) this file gets replaced by
// `_generated/*.ts`; call sites should need minimal churn.
//
// Field names mirror the Rust side (camelCase on wire). Optional fields are
// marked `undefined`-possible; we never synthesize defaults here — callers
// pass what they have.
// -----------------------------------------------------------------------------

// --- initialize handshake -----------------------------------------------------

export interface InitializeParams {
  readonly clientInfo: { readonly name: string; readonly title?: string; readonly version: string }
  readonly capabilities: {
    readonly experimentalApi: boolean
    readonly optOutNotificationMethods: ReadonlyArray<string> | null
  }
}

export interface InitializeResponse {
  readonly userAgent?: string
  readonly codexHome?: string
  readonly platformFamily?: string
  readonly platformOs?: string
}

// --- account/model/collaboration-mode listing --------------------------------

export interface AccountReadResponse {
  readonly account?: {
    readonly type?: 'apiKey' | 'chatgpt'
    readonly planType?: string
    readonly [k: string]: unknown
  }
  readonly requiresOpenaiAuth?: boolean
  readonly [k: string]: unknown
}

export interface ModelListResponse {
  /** Codex v2 shape. */
  readonly data?: ReadonlyArray<CodexModelEntry>
  /** Legacy/generated shape used by older tests and adapters. */
  readonly models?: ReadonlyArray<CodexModelEntry>
  readonly nextCursor?: string | null
  readonly [k: string]: unknown
}

export interface CodexModelEntry {
  readonly id: string
  readonly model?: string
  readonly displayName?: string
  readonly description?: string
  readonly hidden?: boolean
  readonly inputModalities?: ReadonlyArray<string>
  readonly isDefault?: boolean
  readonly supportedReasoningEfforts?: ReadonlyArray<string | { readonly reasoningEffort?: string }>
  readonly defaultReasoningEffort?: string
  readonly [k: string]: unknown
}

export interface CollaborationModeListResponse {
  readonly collaborationModes: ReadonlyArray<CodexCollaborationMode>
  readonly [k: string]: unknown
}

export interface CodexCollaborationMode {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly [k: string]: unknown
}

// --- threads + turns ----------------------------------------------------------

export interface ThreadStartParams {
  readonly model?: string
  readonly cwd: string
  readonly approvalPolicy?: ApprovalPolicy
  readonly approvalsReviewer?: ApprovalsReviewer
  readonly sandbox?: SandboxPolicy
  readonly developerInstructions?: string
  readonly config?: Record<string, unknown>
}

/**
 * Codex 0.104+ returns the thread metadata nested under `thread` — the
 * response carries the server's view of approval/sandbox/model as well,
 * but the only field we extract here is `thread.id`.
 *
 * Do NOT flatten this to `{ threadId: string }`. Previous hand-rolled
 * versions of this file assumed a flat shape (matching an older generated
 * schema from t3), and the drift showed up as `thread/start` returning a
 * response our code silently read as `undefined`, then `turn/start`
 * rejected with "missing field threadId". See provider.ts for the
 * extraction + validation.
 */
export interface ThreadStartResponse {
  readonly thread: { readonly id: string; readonly [k: string]: unknown }
  readonly model?: string
  readonly [k: string]: unknown
}

export interface ThreadResumeParams {
  readonly threadId: string
  readonly developerInstructions?: string
  readonly config?: Record<string, unknown>
}

export interface ThreadResumeResponse {
  readonly thread: { readonly id: string; readonly [k: string]: unknown }
  readonly [k: string]: unknown
}

export interface TurnStartParams {
  readonly threadId: string
  readonly input: ReadonlyArray<CodexInputBlock>
  readonly approvalPolicy?: ApprovalPolicy
  readonly approvalsReviewer?: ApprovalsReviewer
  /**
   * Tagged object — NOT a bare string. Codex's Rust serde enum rejects
   * plain strings for `turn/start.sandboxPolicy`. Use `codexTurnSandboxPolicy`
   * from `./capabilities.ts` to build it. `thread/start.sandbox` is the
   * simpler string variant; don't mix them up.
   */
  readonly sandboxPolicy?: TurnSandboxPolicy
  readonly model?: string
  readonly effort?: string
  readonly collaborationMode?: string
  readonly cwd?: string
  readonly developerInstructions?: string
  readonly config?: Record<string, unknown>
}

export type TurnSandboxPolicy =
  | { readonly type: 'dangerFullAccess' }
  | {
      readonly type: 'workspaceWrite'
      readonly writableRoots?: ReadonlyArray<string>
      readonly networkAccess?: boolean
      readonly excludeSlashTmp?: boolean
      readonly excludeTmpdirEnvVar?: boolean
    }
  | {
      readonly type: 'readOnly'
      readonly networkAccess?: boolean
    }

/**
 * Codex 0.104+ wraps the turn metadata in `turn`. The fields we rely on
 * are `turn.id` (our `codexTurnId`) and, on turn/completed, `turn.status`
 * and `turn.error`. Same rationale as `ThreadStartResponse`: do not
 * flatten — older schema generators used a flat shape that doesn't
 * match the real wire.
 */
export interface TurnStartResponse {
  readonly turn: { readonly id: string; readonly [k: string]: unknown }
  readonly [k: string]: unknown
}

export interface TurnInterruptParams {
  readonly threadId: string
  readonly turnId?: string
}

export type CodexInputBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'localImage'; readonly path: string; readonly mimeType?: string }

export type ApprovalPolicy = 'never' | 'on-request' | 'on-failure' | 'untrusted' | 'always'
export type ApprovalsReviewer = 'user' | 'auto_review' | 'guardian_subagent'
export type SandboxPolicy = 'read-only' | 'workspace-write' | 'danger-full-access'

// --- review/start -------------------------------------------------------------

export type CodexReviewTarget =
  | { readonly type: 'uncommittedChanges' }
  | { readonly type: 'baseBranch'; readonly branch: string }
  | { readonly type: 'commit'; readonly sha: string; readonly title?: string }
  | { readonly type: 'custom'; readonly instructions: string }

export interface ReviewStartParams {
  readonly threadId: string
  readonly target: CodexReviewTarget
  /**
   * `inline` (default): review runs as a turn on the existing thread,
   * emitting the same item/* notifications as any other turn.
   * `detached`: review runs on a new thread whose id is returned as
   * `reviewThreadId`; we don't ship detached-mode plumbing yet.
   */
  readonly delivery?: 'inline' | 'detached'
}

export interface ReviewStartResponse {
  readonly reviewThreadId?: string
  readonly [k: string]: unknown
}

// --- notification payloads (server → us) --------------------------------------

export interface ThreadStartedNotification {
  readonly threadId: string
}

export interface TurnStartedNotification {
  readonly threadId: string
  readonly turn?: { readonly id?: string; readonly [k: string]: unknown }
  readonly turnId?: string
  readonly [k: string]: unknown
}

/**
 * Codex 0.104 shape: `{ threadId, turn: { id, status, items, error? } }`.
 * `stopReason` as a top-level field doesn't exist on the wire — it's
 * derived client-side from `turn.status`.
 */
export interface TurnCompletedNotification {
  readonly threadId: string
  readonly turn: {
    readonly id: string
    readonly status: 'completed' | 'failed' | 'canceled' | 'interrupted' | 'inProgress' | string
    readonly items?: ReadonlyArray<CodexItem>
    readonly error?: { readonly message?: string; readonly code?: string; readonly additionalDetails?: string }
    readonly [k: string]: unknown
  }
  readonly [k: string]: unknown
}

export interface CodexUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly reasoningTokens?: number
  readonly cachedInputTokens?: number
  readonly totalTokens?: number
  readonly [k: string]: unknown
}

export interface ItemStartedNotification {
  readonly threadId: string
  readonly turnId: string
  readonly item: CodexItem
}

export interface ItemCompletedNotification {
  readonly threadId: string
  readonly turnId: string
  readonly item: CodexItem
  readonly status?: 'completed' | 'failed' | 'canceled'
  readonly [k: string]: unknown
}

export interface ItemDeltaNotification {
  readonly threadId: string
  readonly turnId: string
  readonly itemId: string
  readonly delta: string
  readonly [k: string]: unknown
}

/**
 * Codex 0.104 shape: plain UTF-8 `delta` string, no stream discriminator
 * and no base64 encoding. stdout/stderr are mixed at the wire level — if
 * we ever need to separate them we'd have to diff against the full item
 * state on `item/completed`.
 */
export interface CommandExecOutputDeltaNotification {
  readonly threadId: string
  readonly turnId: string
  readonly itemId: string
  readonly delta: string
  readonly [k: string]: unknown
}

export interface RawResponseItemCompletedNotification {
  readonly threadId: string
  readonly turnId: string
  readonly item: {
    readonly id?: string | null
    readonly type: string
    readonly role?: string
    readonly content?: ReadonlyArray<{
      readonly type?: string
      readonly text?: string
      readonly [k: string]: unknown
    }> | null
    readonly [k: string]: unknown
  }
  readonly [k: string]: unknown
}

export interface PlanUpdatedNotification {
  readonly threadId: string
  readonly turnId: string
  readonly plan: ReadonlyArray<CodexPlanEntry>
  readonly [k: string]: unknown
}

export interface CodexPlanEntry {
  readonly content: string
  readonly status?: 'pending' | 'in_progress' | 'completed' | string
  readonly [k: string]: unknown
}

export interface ErrorNotification {
  readonly error?: {
    readonly message?: string
    readonly code?: string
    readonly additionalDetails?: string
    readonly [k: string]: unknown
  }
  readonly message?: string
  readonly code?: string
  readonly recoverable?: boolean
  readonly willRetry?: boolean
  readonly threadId?: string
  readonly turnId?: string
  readonly [k: string]: unknown
}

// --- item shape ---------------------------------------------------------------

export type CodexItemType =
  | 'assistantMessage'
  | 'agentMessage'
  | 'reasoning'
  | 'commandExecution'
  | 'fileChange'
  | 'mcpToolCall'
  | 'webSearch'
  | 'plan'
  | (string & {})

export interface CodexItem {
  readonly id: string
  readonly type: CodexItemType
  readonly [k: string]: unknown
}

// --- server-to-client request shapes (permissions + user input) --------------

export interface RequestApprovalParams {
  readonly threadId: string
  readonly turnId: string
  readonly itemId: string
  readonly title?: string
  readonly detail?: unknown
  readonly [k: string]: unknown
}

export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'

export interface RequestApprovalResponse {
  readonly decision: ApprovalDecision
}

export interface RequestUserInputParams {
  readonly threadId: string
  readonly turnId: string
  readonly questions: ReadonlyArray<{
    readonly id: string
    readonly question: string
    readonly options?: ReadonlyArray<string>
  }>
}

export interface RequestUserInputResponse {
  readonly answers: Record<string, { readonly answers: ReadonlyArray<string> }>
  readonly cancelled?: boolean
}

// --- method name constants ----------------------------------------------------

export const CODEX_METHODS = {
  initialize: 'initialize',
  initialized: 'initialized',
  accountRead: 'account/read',
  modelList: 'model/list',
  collaborationModeList: 'collaborationMode/list',
  threadStart: 'thread/start',
  threadResume: 'thread/resume',
  turnStart: 'turn/start',
  turnInterrupt: 'turn/interrupt',
  reviewStart: 'review/start',
} as const

export const CODEX_SERVER_NOTIFICATIONS = {
  threadStarted: 'thread/started',
  turnStarted: 'turn/started',
  turnCompleted: 'turn/completed',
  itemStarted: 'item/started',
  itemCompleted: 'item/completed',
  rawResponseItemCompleted: 'rawResponseItem/completed',
  agentMessageDelta: 'item/agentMessage/delta',
  reasoningTextDelta: 'item/reasoning/textDelta',
  commandExecOutputDelta: 'item/commandExecution/outputDelta',
  modelRerouted: 'model/rerouted',
  planUpdated: 'turn/plan/updated',
  error: 'error',
} as const

export const CODEX_SERVER_REQUESTS = {
  commandExecApproval: 'item/commandExecution/requestApproval',
  fileChangeApproval: 'item/fileChange/requestApproval',
  userInput: 'item/tool/requestUserInput',
  // Legacy aliases accepted by Codex < 0.104; still handled for parity.
  legacyApplyPatchApproval: 'applyPatchApproval',
  legacyExecCommandApproval: 'execCommandApproval',
  legacyUserInput: 'tool/requestUserInput',
} as const
