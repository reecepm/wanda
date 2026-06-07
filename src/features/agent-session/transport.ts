// -----------------------------------------------------------------------------
// `AgentUITransport` implementation for the Electron renderer / browser web
// entry. Wires `@wanda/agent-ui` to `window.wanda.rpc.agent.session.*`
// (oRPC) + `window.wanda.agentSession.subscribe` (WS events).
//
// The package itself knows nothing about `window.wanda` — if/when we build
// a Storybook harness or run UI tests out of the Electron process, a
// different transport implementation plugs in with zero changes to the
// components.
// -----------------------------------------------------------------------------

import type {
  AgentEvent,
  AgentEventEnvelope,
  Decision,
  PromptBlock,
  QuestionAnswer,
  ReasoningEffort,
  SessionId,
} from '@wanda/agent-protocol'
import { AttachmentIdSchema } from '@wanda/agent-protocol'
import type { AgentUITransport, AttachmentUploadResult, CreateSessionInput, CreateSessionOutput } from '@wanda/agent-ui'
import { getPairedTerminalBridge } from '@/features/servers'
import { orpcForPod, parseNamespacedId } from '../../shared/orpc'

function assertBridge(): void {
  if (typeof window === 'undefined' || !window.wanda) {
    throw new Error('agent-session transport: window.wanda is not installed')
  }
  if (!window.wanda.agentSession) {
    throw new Error(
      'agent-session transport: window.wanda.agentSession is missing — ' +
        'preload is out of date; run the Electron dev shell to pick up the bridge.',
    )
  }
}

export function createAgentSessionTransport(options: { podId?: string | null } = {}): AgentUITransport {
  const client = () => orpcForPod(options.podId)
  const remote = () => parseNamespacedId(options.podId ?? '')
  return {
    async createSession(input: CreateSessionInput): Promise<CreateSessionOutput> {
      assertBridge()
      const result = await client().agent.session.create({
        providerId: input.providerId,
        cwd: input.cwd,
        workspaceId: input.workspaceId ?? null,
        modeId: input.modeId,
        modelId: input.modelId,
        reasoningEffort: input.reasoningEffort,
      })
      return result as CreateSessionOutput
    },

    async prompt(input) {
      assertBridge()
      const result = await client().agent.session.prompt({
        sessionId: input.sessionId,
        content: input.content as PromptBlock[],
        options: input.options,
      })
      return { turnId: result.turnId }
    },

    async cancel(input) {
      assertBridge()
      const result = await client().agent.session.cancel({
        sessionId: input.sessionId,
        turnId: input.turnId,
      })
      return { cancelled: result.cancelled }
    },

    async respondPermission(input: { sessionId: SessionId; requestId: string; decision: Decision }) {
      assertBridge()
      const result = await client().agent.session.respondPermission({
        sessionId: input.sessionId,
        requestId: input.requestId,
        decision: input.decision,
      })
      return { accepted: result.accepted }
    },

    async respondQuestion(input: { sessionId: SessionId; questionId: string; answer: QuestionAnswer }) {
      assertBridge()
      const result = await client().agent.session.respondQuestion({
        sessionId: input.sessionId,
        questionId: input.questionId,
        answer: input.answer,
      })
      return { accepted: result.accepted }
    },

    async close(input) {
      assertBridge()
      const result = await client().agent.session.close({
        sessionId: input.sessionId,
      })
      return { closed: result.closed }
    },

    async setMode(input) {
      assertBridge()
      const result = await client().agent.session.setMode({
        sessionId: input.sessionId,
        modeId: input.modeId,
      })
      return { modeId: result.modeId as typeof input.modeId }
    },

    async setModel(input) {
      assertBridge()
      const result = await client().agent.session.setModel({
        sessionId: input.sessionId,
        modelId: input.modelId,
      })
      return { modelId: result.modelId as typeof input.modelId }
    },

    async setReasoningEffort(input: { sessionId: SessionId; reasoningEffort: ReasoningEffort }) {
      assertBridge()
      const result = await client().agent.session.setReasoningEffort({
        sessionId: input.sessionId,
        reasoningEffort: input.reasoningEffort,
      })
      return { reasoningEffort: result.reasoningEffort as ReasoningEffort }
    },

    async startReview(input) {
      assertBridge()
      const result = await client().agent.session.startReview({
        sessionId: input.sessionId,
        target: input.target,
      })
      return { turnId: result.turnId, reviewThreadId: result.reviewThreadId }
    },

    async uploadAttachment(input): Promise<AttachmentUploadResult> {
      assertBridge()
      // Normalise to a backing `ArrayBuffer` (not `SharedArrayBuffer`). oRPC's
      // generated Uint8Array input type is strict about the buffer family.
      const inputBytes = input.bytes as Uint8Array
      const bytes =
        inputBytes.buffer instanceof ArrayBuffer
          ? (inputBytes as Uint8Array<ArrayBuffer>)
          : new Uint8Array(new Uint8Array(inputBytes).buffer as ArrayBuffer)
      const result = await client().agent.attachment.upload({
        bytes,
        mediaType: input.mediaType,
        name: input.name,
        sessionId: input.sessionId,
      })
      return {
        id: AttachmentIdSchema.parse(result.id),
        sha256: result.sha256,
        mediaType: result.mediaType,
        size: result.size,
        name: result.name ?? null,
      }
    },

    attachmentUrl(id) {
      if (remote()) throw new Error('attachmentUrl: remote agent-session attachments are not supported yet')
      const conn = window.wanda?.connection?.get?.()
      if (!conn) throw new Error('attachmentUrl: no connection info on window.wanda')
      return `${conn.httpUrl}/attachments/${id}`
    },

    attachmentAuthHeaders(sessionId) {
      if (remote()) throw new Error('attachmentAuthHeaders: remote agent-session attachments are not supported yet')
      const conn = window.wanda?.connection?.get?.()
      if (!conn) throw new Error('attachmentAuthHeaders: no connection info on window.wanda')
      const headers: Record<string, string> = {
        authorization: `Bearer ${conn.sessionToken}`,
      }
      if (sessionId) headers['x-agent-session-id'] = sessionId
      return headers
    },

    subscribeToSession(sessionId, onEnvelope, options) {
      assertBridge()
      const remotePod = remote()
      if (remotePod) {
        let disposed = false
        let release: (() => void) | null = null
        void getPairedTerminalBridge(remotePod.registryId).then((bridge) => {
          if (disposed) return
          bridge.retain()
          const unsubscribe = bridge.subscribeAgentSession(
            sessionId,
            (payload: unknown, seq: number) => {
              const env = payload as AgentEventEnvelope
              onEnvelope({ seq, payload: env.event as AgentEvent })
            },
            options,
          )
          release = () => {
            unsubscribe()
            bridge.release()
          }
        })
        return () => {
          disposed = true
          release?.()
        }
      }
      return window.wanda.agentSession.subscribe(
        sessionId,
        (payload: unknown, seq: number) => {
          // The server sends `AgentEventEnvelope = { schemaVersion, event }`
          // wrapped in the WS envelope's args[0].payload. Pass just the
          // event up; seq drives the store's dedup cursor.
          const env = payload as AgentEventEnvelope
          onEnvelope({ seq, payload: env.event as AgentEvent })
        },
        options,
      )
    },
    replayForSession({ sessionId, sinceSeq }) {
      assertBridge()
      const remotePod = remote()
      if (remotePod) {
        void getPairedTerminalBridge(remotePod.registryId).then((bridge) => {
          bridge.replayAgentSession({ sessionId, sinceSeq })
        })
        return true
      }
      return window.wanda.agentSession.replayForSession({
        sessionId,
        sinceSeq,
      })
    },
  }
}
