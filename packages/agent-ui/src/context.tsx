// -----------------------------------------------------------------------------
// AgentUIProvider — dependency-injected transport + per-session store registry.
//
// The UI package never imports from `electron/` or `@wanda/client-connection`;
// consumers plug in a transport shaped like `AgentUITransport`. That keeps
// the package usable by the Electron renderer, a browser build, or a
// Storybook harness without hard-wiring to any specific client.
// -----------------------------------------------------------------------------

import type {
  AgentEvent,
  AttachmentId,
  Decision,
  ModeId,
  ModelId,
  PromptBlock,
  QuestionAnswer,
  ReasoningEffort,
  ReviewTarget,
  SessionId,
} from '@wanda/agent-protocol'
import { type ChatStoreHandle, createChatStore } from '@wanda/agent-store'
import { createContext, type ReactNode, useContext, useMemo, useRef } from 'react'

export interface AttachmentUploadResult {
  readonly id: AttachmentId
  readonly sha256: string
  readonly mediaType: string
  readonly size: number
  readonly name: string | null
}

export interface CreateSessionInput {
  readonly providerId: string
  readonly cwd: string
  readonly workspaceId?: string | null
  readonly modeId?: string
  readonly modelId?: string
  readonly reasoningEffort?: ReasoningEffort
}

export interface CreateSessionOutput {
  readonly sessionId: SessionId
  readonly [k: string]: unknown
}

/**
 * Transport surface the UI needs. The Electron renderer wires these to
 * `window.wanda.rpc.agent.session.*` + the WS event stream; a browser build
 * wires them to the same oRPC client over plain HTTP+WS.
 */
export interface AgentUITransport {
  readonly createSession: (input: CreateSessionInput) => Promise<CreateSessionOutput>
  readonly prompt: (input: {
    sessionId: SessionId
    content: ReadonlyArray<PromptBlock>
    options?: { modeId?: string }
  }) => Promise<{ turnId: string }>
  readonly cancel: (input: { sessionId: SessionId; turnId?: string }) => Promise<{ cancelled: boolean }>
  readonly respondPermission: (input: {
    sessionId: SessionId
    requestId: string
    decision: Decision
  }) => Promise<{ accepted: boolean }>
  readonly respondQuestion: (input: {
    sessionId: SessionId
    questionId: string
    answer: QuestionAnswer
  }) => Promise<{ accepted: boolean }>
  readonly close: (input: { sessionId: SessionId }) => Promise<{ closed: boolean }>
  /**
   * Switch the active mode on the session. Optional — transports that don't
   * support mode switching (e.g. storybook mocks) can omit this and the
   * header dropdown stays read-only.
   */
  readonly setMode?: (input: { sessionId: SessionId; modeId: ModeId }) => Promise<{ modeId: ModeId }>
  readonly setModel?: (input: { sessionId: SessionId; modelId: ModelId }) => Promise<{ modelId: ModelId }>
  readonly setReasoningEffort?: (input: {
    sessionId: SessionId
    reasoningEffort: ReasoningEffort
  }) => Promise<{ reasoningEffort: ReasoningEffort }>
  /**
   * Kick off a provider-native code review. Runs as a turn on the
   * current session — the assistant's response flows through the
   * normal event stream. Optional: transports / providers without
   * review support should omit this, and the composer button stays
   * hidden.
   */
  readonly startReview?: (input: {
    sessionId: SessionId
    target: ReviewTarget
  }) => Promise<{ turnId?: string; reviewThreadId?: string }>
  /**
   * Upload a blob to the content-addressed attachment store. Returns a
   * ref the caller can include in the next prompt. Optional: transports
   * that don't support attachments can omit this, and the composer will
   * hide its image-paste UX.
   */
  readonly uploadAttachment?: (input: {
    bytes: Uint8Array
    mediaType: string
    name?: string
    sessionId?: SessionId
  }) => Promise<AttachmentUploadResult>
  /**
   * Build a URL the renderer can `fetch()` (or stuff into `<img src>`) for
   * a stored attachment blob. Optional for the same reason as
   * `uploadAttachment`.
   */
  readonly attachmentUrl?: (id: AttachmentId) => string
  /**
   * Request bearer + auxiliary headers needed to fetch an attachment blob.
   * Electron returns the local session token; the browser build returns
   * the same. Optional — transports without HTTP fetch (e.g. Storybook
   * mocks) may skip this.
   */
  readonly attachmentAuthHeaders?: (sessionId?: SessionId) => Record<string, string>
  /**
   * Subscribe to the live envelope stream for one session. The callback
   * receives envelopes already seq-tagged by the server. Unsubscribe by
   * calling the returned function.
   */
  readonly subscribeToSession: (
    sessionId: SessionId,
    onEnvelope: (envelope: { seq: number; payload: AgentEvent }) => void,
    options?: { replayFromSeq?: number },
  ) => () => void
  /**
   * Ask the server to replay every persisted event for this session from
   * `sinceSeq` forward, streamed back through the same subscription.
   * Optional — transports without a durable event log (Storybook mocks)
   * may omit it. Returns `true` if the request went out, `false` if the
   * transport isn't ready yet (no server epoch captured).
   */
  readonly replayForSession?: (input: { sessionId: SessionId; sinceSeq: number }) => boolean
}

export interface AgentUIContextValue {
  readonly transport: AgentUITransport
  readonly getStore: (sessionId: SessionId) => ChatStoreHandle
}

const AgentUIContext = createContext<AgentUIContextValue | null>(null)

export interface AgentUIProviderProps {
  readonly transport: AgentUITransport
  readonly children: ReactNode
  /**
   * Optional hook called the first time a store is created for a session.
   * Useful for installing the subscribe / replay handshake. If omitted the
   * store stays passive — the UI renders whatever envelopes you feed into
   * it directly via `store.applyLiveEvent`.
   */
  readonly onStoreCreated?: (sessionId: SessionId, store: ChatStoreHandle) => void
}

export function AgentUIProvider({ transport, children, onStoreCreated }: AgentUIProviderProps) {
  // Registry is a ref — we don't want re-renders when a new store is
  // registered. React scheduling handles the subscribe fan-out via
  // useSyncExternalStore in the hooks.
  const registryRef = useRef<Map<SessionId, ChatStoreHandle>>(new Map())
  const onStoreCreatedRef = useRef(onStoreCreated)
  onStoreCreatedRef.current = onStoreCreated

  const value = useMemo<AgentUIContextValue>(
    () => ({
      transport,
      getStore(sessionId) {
        let store = registryRef.current.get(sessionId)
        if (!store) {
          store = createChatStore(sessionId)
          registryRef.current.set(sessionId, store)
          onStoreCreatedRef.current?.(sessionId, store)
        }
        return store
      },
    }),
    [transport],
  )

  return <AgentUIContext.Provider value={value}>{children}</AgentUIContext.Provider>
}

export function useAgentUI(): AgentUIContextValue {
  const ctx = useContext(AgentUIContext)
  if (!ctx) {
    throw new Error('useAgentUI: missing <AgentUIProvider> ancestor')
  }
  return ctx
}

export function useAgentTransport(): AgentUITransport {
  return useAgentUI().transport
}

/** Get (or lazily create) the ChatStoreHandle for a session. */
export function useChatStore(sessionId: SessionId): ChatStoreHandle {
  const { getStore } = useAgentUI()
  return useMemo(() => getStore(sessionId), [getStore, sessionId])
}
