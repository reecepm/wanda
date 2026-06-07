import { create } from 'zustand'

export interface AgentModel {
  id: string
  label: string
}

/** Populated at runtime by model/list from the Codex app server */
export const FALLBACK_MODELS: AgentModel[] = []

export const DEFAULT_MODEL = ''

export interface AgentSession {
  id: string
  threadId: string | null
  status: 'running' | 'idle' | 'stopped'
  cwd: string
}

export interface CodexItem {
  type: 'commandExecution' | 'fileChange' | 'mcpToolCall' | 'agentMessage' | 'reasoning'
  id: string
  // commandExecution
  command?: string
  cwd?: string
  exitCode?: number
  output?: string
  // fileChange
  changes?: { path: string; diff?: string }[]
  // mcpToolCall
  server?: string
  tool?: string
  arguments?: Record<string, unknown>
  result?: unknown
  // agentMessage
  text?: string
}

export interface ChatMessage {
  id: string
  type: 'user' | 'assistant' | 'system' | 'result' | 'reasoning'
  content: string
  items?: CodexItem[]
  result?: { numTurns: number; durationMs: number; inputTokens: number; outputTokens: number }
  streaming?: boolean
}

export interface ApprovalRequest {
  requestId: number
  type: 'commandExecution' | 'fileChange'
  command?: string
  cwd?: string
  reason?: string
  grantRoot?: string
}

interface AgentState {
  session: AgentSession | null
  messages: ChatMessage[]
  model: string
  availableModels: AgentModel[]
  /** Whether the Codex app server has finished initializing */
  agentReady: boolean
  pendingPermission: ApprovalRequest | null
  authRequired: boolean
  authUrl: string | null
  /** Internal: ID of the message currently being streamed */
  _streamingId: string | null
  setSession: (s: AgentSession | null) => void
  setModel: (m: string) => void
  setAvailableModels: (models: AgentModel[]) => void
  setAgentReady: (ready: boolean) => void
  addMessage: (msg: ChatMessage) => void
  appendStreamingText: (text: string) => void
  startStreamingMessage: (id: string) => void
  finalizeStreamingMessage: (content: string, items?: CodexItem[]) => void
  clearMessages: () => void
  setPendingPermission: (p: ApprovalRequest | null) => void
  setAuthRequired: (required: boolean, url?: string | null) => void
}

export const useAgentStore = create<AgentState>()((set) => ({
  session: null,
  messages: [],
  model: DEFAULT_MODEL,
  availableModels: FALLBACK_MODELS,
  agentReady: false,
  pendingPermission: null,
  authRequired: false,
  authUrl: null,
  _streamingId: null,

  setSession: (session) => set({ session }),
  setModel: (model) => set({ model }),
  setAvailableModels: (models) => {
    set((s) => {
      // If current model isn't in the new list, switch to first available
      const hasCurrentModel = s.model && models.find((m) => m.id === s.model)
      const newModel = hasCurrentModel ? s.model : (models[0]?.id ?? '')
      return { availableModels: models, model: newModel }
    })
  },
  setAgentReady: (agentReady) => set({ agentReady }),

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  startStreamingMessage: (id) =>
    set((s) => ({
      _streamingId: id,
      messages: [...s.messages, { id, type: 'assistant', content: '', streaming: true }],
    })),

  appendStreamingText: (text) =>
    set((s) => {
      if (!s._streamingId) return s
      return {
        messages: s.messages.map((m) => (m.id === s._streamingId ? { ...m, content: m.content + text } : m)),
      }
    }),

  finalizeStreamingMessage: (content, items) =>
    set((s) => {
      if (!s._streamingId) return s
      return {
        _streamingId: null,
        messages: s.messages.map((m) => (m.id === s._streamingId ? { ...m, content, items, streaming: false } : m)),
      }
    }),

  clearMessages: () => set({ messages: [], _streamingId: null }),
  setPendingPermission: (pendingPermission) => set({ pendingPermission }),
  setAuthRequired: (authRequired, authUrl = null) => set({ authRequired, authUrl }),
}))
