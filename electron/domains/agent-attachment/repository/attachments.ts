import type { AttachmentId, SessionId } from '@wanda/agent-protocol'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import type { AppDatabase } from '../../../db/connection'
import { agentAttachments } from '../../../db/schema'

type Row = typeof agentAttachments.$inferSelect

export interface AttachmentRow {
  readonly id: AttachmentId
  readonly sessionId: SessionId | null
  readonly mimeType: string
  readonly byteSize: number
  readonly sha256: string
  readonly originalFilename: string | null
  readonly source: 'user' | 'agent'
  readonly firstReferencedTurnId: string | null
  readonly createdAt: number
}

export function rowToDomain(row: Row): AttachmentRow {
  return {
    id: row.id as AttachmentId,
    sessionId: (row.sessionId ?? null) as SessionId | null,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    originalFilename: row.originalFilename,
    source: row.source,
    firstReferencedTurnId: row.firstReferencedTurnId,
    createdAt: row.createdAt.getTime(),
  }
}

export function findBySessionSha(
  db: AppDatabase,
  input: {
    sessionId: SessionId | null
    sha256: string
  },
): AttachmentRow | null {
  const clauses = [
    input.sessionId == null
      ? isNull(agentAttachments.sessionId)
      : eq(agentAttachments.sessionId, input.sessionId as string),
    eq(agentAttachments.sha256, input.sha256),
  ]
  const row = db
    .select()
    .from(agentAttachments)
    .where(and(...clauses))
    .get()
  return row ? rowToDomain(row) : null
}

export function insertAttachment(
  db: AppDatabase,
  input: {
    id: AttachmentId
    sessionId: SessionId | null
    mimeType: string
    byteSize: number
    sha256: string
    originalFilename: string | null
    source: 'user' | 'agent'
    createdAt: Date
  },
) {
  db.insert(agentAttachments)
    .values({
      id: input.id as string,
      sessionId: input.sessionId as string | null,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      originalFilename: input.originalFilename,
      source: input.source,
      firstReferencedTurnId: null,
      createdAt: input.createdAt,
    })
    .run()
}

export function findAttachmentById(db: AppDatabase, id: AttachmentId): AttachmentRow | null {
  const row = db
    .select()
    .from(agentAttachments)
    .where(eq(agentAttachments.id, id as string))
    .get()
  return row ? rowToDomain(row) : null
}

export function bindAttachmentToSession(
  db: AppDatabase,
  input: {
    id: AttachmentId
    sessionId: SessionId
    turnId?: string
  },
) {
  db.update(agentAttachments)
    .set({
      sessionId: input.sessionId as string,
      firstReferencedTurnId: input.turnId ?? null,
    })
    .where(and(eq(agentAttachments.id, input.id as string), isNull(agentAttachments.sessionId)))
    .run()
}

export function ensureAttachmentBoundToSession(
  db: AppDatabase,
  input: {
    id: AttachmentId
    sessionId: SessionId
    turnId?: string
  },
) {
  const sessionId = input.sessionId as string
  const result = db
    .update(agentAttachments)
    .set({
      sessionId,
      firstReferencedTurnId: sql`COALESCE(${agentAttachments.firstReferencedTurnId}, ${input.turnId ?? null})`,
    })
    .where(
      and(
        eq(agentAttachments.id, input.id as string),
        or(isNull(agentAttachments.sessionId), eq(agentAttachments.sessionId, sessionId)),
      ),
    )
    .run()
  return result.changes > 0
}
