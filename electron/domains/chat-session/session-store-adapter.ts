// -----------------------------------------------------------------------------
// SessionStore adapter — bridges the synchronous `SessionStore` interface
// that `@wanda/agent-runtime` consumes onto Drizzle-backed `chat_sessions`
// writes. `better-sqlite3` is sync under the hood, so the adapter can call
// through directly via `DatabaseService`.
// -----------------------------------------------------------------------------

import type { SessionId } from '@wanda/agent-protocol'
import type {
  PersistedSessionSnapshot,
  SessionStateTag,
  SessionStore,
  SessionStoreInsert,
  TitleSource,
} from '@wanda/agent-runtime'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { AppDatabase } from '../../db/connection'
import { type AgentPersistenceHandle, chatSessions } from '../../db/schema'
import { log } from '../../packages/logger'

/** Internal persisted runtime states reduce onto the richer DB enum. */
const STORE_STATE_MAP: Record<SessionStateTag, typeof chatSessions.$inferInsert.state> = {
  starting: 'starting',
  ready: 'idle',
  running: 'running',
  error: 'error',
  closed: 'closed',
  cold: 'idle',
}

const DB_STATE_TO_TAG: Record<NonNullable<typeof chatSessions.$inferSelect.state>, SessionStateTag> = {
  idle: 'ready',
  starting: 'starting',
  running: 'running',
  error: 'error',
  closed: 'closed',
}

type Row = typeof chatSessions.$inferSelect

function toSnapshot(row: Row): PersistedSessionSnapshot {
  return {
    id: row.id as SessionId,
    providerId: row.providerId,
    workspaceId: row.workspaceId,
    podId: row.podId,
    cwd: row.cwd,
    title: row.title,
    titleSource: row.titleSource,
    capabilities: row.capabilities,
    modes: row.modes,
    modelOptions: row.modelOptions,
    currentModeId: row.currentModeId,
    currentModelId: row.currentModelId,
    currentReasoningEffort: row.currentReasoningEffort,
    persistenceHandle: row.persistenceHandle,
    state: DB_STATE_TO_TAG[row.state] ?? 'ready',
    lastEventSeq: row.lastEventSeq,
    lastEventAt: row.lastEventAt == null ? null : row.lastEventAt.getTime(),
    archivedAt: row.archivedAt == null ? null : row.archivedAt.getTime(),
    createdAt: row.createdAt.getTime(),
  }
}

export function makeDrizzleSessionStore(db: AppDatabase): SessionStore {
  const warn = (msg: string, ctx?: unknown) => log.main.warn(msg, ctx)

  const insert = (input: SessionStoreInsert): void => {
    try {
      const now = new Date()
      db.insert(chatSessions)
        .values({
          id: input.id as string,
          workspaceId: input.workspaceId,
          podId: input.podId,
          providerId: input.providerId,
          cwd: input.cwd,
          capabilities: input.capabilities,
          modes: [...input.modes],
          modelOptions: [...input.modelOptions],
          currentModeId: input.currentModeId,
          currentModelId: input.currentModelId,
          currentReasoningEffort: input.currentReasoningEffort,
          persistenceHandle: input.persistenceHandle as AgentPersistenceHandle | null,
          state: 'idle',
          createdAt: now,
          updatedAt: now,
        })
        .run()
    } catch (err) {
      warn('chat_sessions insert failed', { sessionId: input.id, err })
    }
  }

  const findById = (id: SessionId): PersistedSessionSnapshot | null => {
    try {
      const row = db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, id as string))
        .get()
      return row ? toSnapshot(row) : null
    } catch (err) {
      warn('chat_sessions findById failed', { sessionId: id, err })
      return null
    }
  }

  const markState = (id: SessionId, state: SessionStateTag, lastError?: string | null): void => {
    try {
      const mapped = STORE_STATE_MAP[state] ?? 'idle'
      const update: Partial<typeof chatSessions.$inferInsert> = {
        state: mapped,
        updatedAt: new Date(),
      }
      if (lastError !== undefined) update.lastError = lastError
      db.update(chatSessions)
        .set(update)
        .where(eq(chatSessions.id, id as string))
        .run()
    } catch (err) {
      warn('chat_sessions markState failed', { sessionId: id, state, err })
    }
  }

  const markClosed = (id: SessionId, reason?: string): void => {
    try {
      db.update(chatSessions)
        .set({
          state: 'closed',
          lastError: reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(chatSessions.id, id as string))
        .run()
    } catch (err) {
      warn('chat_sessions markClosed failed', { sessionId: id, err })
    }
  }

  const updatePersistenceHandle = (id: SessionId, handle: AgentPersistenceHandle | null): void => {
    try {
      db.update(chatSessions)
        .set({ persistenceHandle: handle, updatedAt: new Date() })
        .where(eq(chatSessions.id, id as string))
        .run()
    } catch (err) {
      warn('chat_sessions updatePersistenceHandle failed', { sessionId: id, err })
    }
  }

  const updateMode = (id: SessionId, modeId: string | null): void => {
    try {
      db.update(chatSessions)
        .set({ currentModeId: modeId, updatedAt: new Date() })
        .where(eq(chatSessions.id, id as string))
        .run()
    } catch (err) {
      warn('chat_sessions updateMode failed', { sessionId: id, err })
    }
  }

  const updateModel = (id: SessionId, modelId: string | null): void => {
    try {
      db.update(chatSessions)
        .set({ currentModelId: modelId, updatedAt: new Date() })
        .where(eq(chatSessions.id, id as string))
        .run()
    } catch (err) {
      warn('chat_sessions updateModel failed', { sessionId: id, err })
    }
  }

  const updateReasoningEffort: SessionStore['updateReasoningEffort'] = (id, effort) => {
    try {
      db.update(chatSessions)
        .set({ currentReasoningEffort: effort, updatedAt: new Date() })
        .where(eq(chatSessions.id, id as string))
        .run()
    } catch (err) {
      warn('chat_sessions updateReasoningEffort failed', { sessionId: id, err })
    }
  }

  const updateLastEvent = (id: SessionId, seq: number, at: number): void => {
    try {
      db.update(chatSessions)
        .set({
          lastEventSeq: seq,
          lastEventAt: new Date(at),
          updatedAt: new Date(),
        })
        .where(eq(chatSessions.id, id as string))
        .run()
    } catch (err) {
      warn('chat_sessions updateLastEvent failed', { sessionId: id, err })
    }
  }

  const list: SessionStore['list'] = (filter) => {
    try {
      const clauses = []
      if (!(filter?.includeArchived ?? false)) clauses.push(isNull(chatSessions.archivedAt))
      if (filter?.workspaceId !== undefined) {
        clauses.push(
          filter.workspaceId === null
            ? isNull(chatSessions.workspaceId)
            : eq(chatSessions.workspaceId, filter.workspaceId),
        )
      }
      const base = db.select().from(chatSessions)
      const filtered = clauses.length > 0 ? base.where(and(...clauses)) : base
      const rows = filtered.orderBy(desc(chatSessions.lastEventAt), desc(chatSessions.createdAt)).all()
      return rows.map(toSnapshot)
    } catch (err) {
      warn('chat_sessions list failed', { err })
      return []
    }
  }

  const updateTitle = (id: SessionId, title: string, source: TitleSource): void => {
    try {
      // `source: 'auto'` must not clobber a user-chosen title.
      if (source === 'auto') {
        const row = db
          .select({ titleSource: chatSessions.titleSource })
          .from(chatSessions)
          .where(eq(chatSessions.id, id as string))
          .get()
        if (row?.titleSource === 'user') return
      }
      db.update(chatSessions)
        .set({ title, titleSource: source, updatedAt: new Date() })
        .where(eq(chatSessions.id, id as string))
        .run()
    } catch (err) {
      warn('chat_sessions updateTitle failed', { sessionId: id, err })
    }
  }

  const archive: SessionStore['archive'] = (id) => {
    try {
      db.update(chatSessions)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(chatSessions.id, id as string))
        .run()
    } catch (err) {
      warn('chat_sessions archive failed', { sessionId: id, err })
    }
  }

  const unarchive: SessionStore['unarchive'] = (id) => {
    try {
      db.update(chatSessions)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(chatSessions.id, id as string))
        .run()
    } catch (err) {
      warn('chat_sessions unarchive failed', { sessionId: id, err })
    }
  }

  return {
    insert,
    findById,
    list,
    markState,
    markClosed,
    updatePersistenceHandle,
    updateMode,
    updateModel,
    updateReasoningEffort,
    updateLastEvent,
    updateTitle,
    archive,
    unarchive,
  }
}
