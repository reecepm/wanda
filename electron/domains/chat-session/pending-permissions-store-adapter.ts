// -----------------------------------------------------------------------------
// PendingPermissionsStore Drizzle adapter — bridges the sync
// `PendingPermissionsStore` the runtime consumes onto the
// `agent_pending_permissions` table.
// -----------------------------------------------------------------------------

import type { Decision, PermissionRequest, RequestId, SessionId, TurnId } from '@wanda/agent-protocol'
import type { PendingPermissionRow, PendingPermissionsStore, PendingPermissionsStoreInsert } from '@wanda/agent-runtime'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { AppDatabase } from '../../db/connection'
import { agentPendingPermissions } from '../../db/schema'
import { log } from '../../packages/logger'

type Row = typeof agentPendingPermissions.$inferSelect

function toDomain(row: Row): PendingPermissionRow {
  return {
    requestId: row.id as RequestId,
    sessionId: row.sessionId as SessionId,
    turnId: row.turnId as TurnId,
    eventSeq: row.eventSeq,
    request: row.request as PermissionRequest,
    createdAt: row.createdAt.getTime(),
    resolvedAt: row.resolvedAt == null ? null : row.resolvedAt.getTime(),
    resolution: (row.resolution ?? null) as Decision | null,
  }
}

export function makeDrizzlePendingPermissionsStore(db: AppDatabase): PendingPermissionsStore {
  const warn = (msg: string, ctx?: unknown) => log.main.warn(msg, ctx)

  const insert = (input: PendingPermissionsStoreInsert): void => {
    try {
      db.insert(agentPendingPermissions)
        .values({
          id: input.requestId as string,
          sessionId: input.sessionId as string,
          turnId: input.turnId as string,
          eventSeq: input.eventSeq,
          request: input.request,
          createdAt: new Date(),
        })
        .run()
    } catch (err) {
      warn('agent_pending_permissions insert failed', { requestId: input.requestId, err })
    }
  }

  const resolve = (requestId: RequestId, decision: Decision): void => {
    try {
      // `resolved_at IS NULL` guard makes resolve idempotent at the DB level:
      // a late `permission.resolved` arriving after the boot drain won't
      // overwrite the synthetic deny.
      db.update(agentPendingPermissions)
        .set({ resolvedAt: new Date(), resolution: decision })
        .where(and(eq(agentPendingPermissions.id, requestId as string), isNull(agentPendingPermissions.resolvedAt)))
        .run()
    } catch (err) {
      warn('agent_pending_permissions resolve failed', { requestId, err })
    }
  }

  const listUnresolved = (): ReadonlyArray<PendingPermissionRow> => {
    try {
      const rows = db
        .select()
        .from(agentPendingPermissions)
        .where(isNull(agentPendingPermissions.resolvedAt))
        .orderBy(asc(agentPendingPermissions.createdAt))
        .all()
      return rows.map(toDomain)
    } catch (err) {
      warn('agent_pending_permissions listUnresolved failed', { err })
      return []
    }
  }

  return { insert, resolve, listUnresolved }
}
