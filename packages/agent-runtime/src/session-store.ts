// -----------------------------------------------------------------------------
// SessionStore — synchronous persistence hook for the runtime.
//
// The runtime package is DB-agnostic. Electron provides a real impl that
// writes to `chat_sessions` via Drizzle; tests pass an in-memory impl (or
// nothing — the runtime no-ops when no store is configured).
//
// All methods are sync — better-sqlite3 is synchronous, and keeping this
// interface sync keeps the hot path (state transitions, persistence handle
// updates) allocation-free.
// -----------------------------------------------------------------------------

import type { ReasoningEffort, SessionId } from '@wanda/agent-protocol'
import type { SessionStateTag } from './state-machine.ts'
import type { PersistenceHandle } from './types.ts'

export type TitleSource = 'auto' | 'user'

export interface PersistedSessionSnapshot {
  readonly id: SessionId
  readonly providerId: string
  readonly workspaceId: string | null
  readonly podId: string | null
  readonly cwd: string
  readonly title: string | null
  readonly titleSource: TitleSource
  readonly capabilities: import('@wanda/agent-protocol').AgentCapabilities
  readonly modes: ReadonlyArray<import('@wanda/agent-protocol').AgentMode>
  readonly modelOptions: ReadonlyArray<import('@wanda/agent-protocol').ModelOption>
  readonly currentModeId: string | null
  readonly currentModelId: string | null
  readonly currentReasoningEffort: ReasoningEffort | null
  readonly persistenceHandle: PersistenceHandle | null
  readonly state: SessionStateTag
  readonly lastEventSeq: number | null
  readonly lastEventAt: number | null
  readonly archivedAt: number | null
  readonly createdAt: number
}

export interface SessionStoreInsert {
  readonly id: SessionId
  readonly providerId: string
  readonly workspaceId: string | null
  readonly podId: string | null
  readonly cwd: string
  readonly capabilities: import('@wanda/agent-protocol').AgentCapabilities
  readonly modes: ReadonlyArray<import('@wanda/agent-protocol').AgentMode>
  readonly modelOptions: ReadonlyArray<import('@wanda/agent-protocol').ModelOption>
  readonly currentModeId: string | null
  readonly currentModelId: string | null
  readonly currentReasoningEffort: ReasoningEffort | null
  readonly persistenceHandle: PersistenceHandle | null
}

export interface SessionStore {
  readonly insert: (input: SessionStoreInsert) => void
  readonly findById: (id: SessionId) => PersistedSessionSnapshot | null
  /**
   * List persisted sessions, optionally filtered by workspace. Rows come
   * sorted by `lastEventAt DESC, createdAt DESC` so the most-recently-active
   * session is first. `includeArchived` defaults to false.
   */
  readonly list: (filter?: {
    workspaceId?: string | null
    includeArchived?: boolean
  }) => ReadonlyArray<PersistedSessionSnapshot>
  readonly markState: (id: SessionId, state: SessionStateTag, lastError?: string | null) => void
  readonly markClosed: (id: SessionId, reason?: string) => void
  readonly updatePersistenceHandle: (id: SessionId, handle: PersistenceHandle | null) => void
  readonly updateMode: (id: SessionId, modeId: string | null) => void
  readonly updateModel: (id: SessionId, modelId: string | null) => void
  readonly updateReasoningEffort: (id: SessionId, effort: ReasoningEffort | null) => void
  readonly updateLastEvent: (id: SessionId, seq: number, at: number) => void
  /**
   * Set the display title. `source: 'auto'` respects a previously user-set
   * title (no-op); `source: 'user'` overwrites.
   */
  readonly updateTitle: (id: SessionId, title: string, source: TitleSource) => void
  readonly archive: (id: SessionId) => void
  /** Clear `archivedAt`, bringing the row back into the default listing. */
  readonly unarchive: (id: SessionId) => void
}

/** In-memory implementation used by tests. */
export function makeInMemorySessionStore(): SessionStore {
  const rows = new Map<SessionId, PersistedSessionSnapshot>()
  const now = () => Date.now()
  const patch = (id: SessionId, f: (row: PersistedSessionSnapshot) => PersistedSessionSnapshot) => {
    const existing = rows.get(id)
    if (existing) rows.set(id, f(existing))
  }
  return {
    insert(input) {
      rows.set(input.id, {
        ...input,
        title: null,
        titleSource: 'auto',
        state: 'ready',
        lastEventSeq: null,
        lastEventAt: null,
        archivedAt: null,
        createdAt: now(),
      })
    },
    findById(id) {
      return rows.get(id) ?? null
    },
    list(filter) {
      const includeArchived = filter?.includeArchived ?? false
      const wanted: PersistedSessionSnapshot[] = []
      for (const row of rows.values()) {
        if (!includeArchived && row.archivedAt != null) continue
        if (filter?.workspaceId !== undefined && row.workspaceId !== filter.workspaceId) continue
        wanted.push(row)
      }
      wanted.sort((a, b) => {
        const aAt = a.lastEventAt ?? a.createdAt
        const bAt = b.lastEventAt ?? b.createdAt
        return bAt - aAt
      })
      return wanted
    },
    markState(id, state) {
      patch(id, (row) => ({ ...row, state }))
    },
    markClosed(id) {
      patch(id, (row) => ({ ...row, state: 'closed' }))
    },
    updatePersistenceHandle(id, handle) {
      patch(id, (row) => ({ ...row, persistenceHandle: handle }))
    },
    updateMode(id, modeId) {
      patch(id, (row) => ({ ...row, currentModeId: modeId }))
    },
    updateModel(id, modelId) {
      patch(id, (row) => ({ ...row, currentModelId: modelId }))
    },
    updateReasoningEffort(id, effort) {
      patch(id, (row) => ({ ...row, currentReasoningEffort: effort }))
    },
    updateLastEvent(id, seq, at) {
      patch(id, (row) => ({ ...row, lastEventSeq: seq, lastEventAt: at }))
    },
    updateTitle(id, title, source) {
      patch(id, (row) => {
        if (source === 'auto' && row.titleSource === 'user') return row
        return { ...row, title, titleSource: source }
      })
    },
    archive(id) {
      patch(id, (row) => ({ ...row, archivedAt: now() }))
    },
    unarchive(id) {
      patch(id, (row) => ({ ...row, archivedAt: null }))
    },
  }
}
