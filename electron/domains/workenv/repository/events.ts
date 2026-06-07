// -----------------------------------------------------------------------------
// Workenv event repository — append-only, paginated read.
//
// Events are observational only (the workenv row is authoritative).
// Pagination is "newest first" so the UI can show the latest activity strip
// without scanning the whole history.
// -----------------------------------------------------------------------------

import { desc, eq } from 'drizzle-orm'
import type { WorkenvEventType } from '../../../../shared/contracts/workenv'
import type { AppDatabase } from '../../../db/connection'
import { insertAndReturn } from '../../../db/helpers'
import { workenvEvents } from '../../../db/schema'

export type WorkenvEventRow = typeof workenvEvents.$inferSelect

export interface AppendEventInput {
  readonly workenvId: string
  readonly type: WorkenvEventType
  readonly payload?: Record<string, unknown> | null
}

export interface ListEventsOptions {
  readonly limit?: number
}

export function appendWorkenvEvent(db: AppDatabase, input: AppendEventInput): WorkenvEventRow {
  return insertAndReturn(db, workenvEvents, {
    workenvId: input.workenvId,
    type: input.type,
    payload: input.payload ?? null,
  })
}

export function listEventsForWorkenv(
  db: AppDatabase,
  workenvId: string,
  opts: ListEventsOptions = {},
): WorkenvEventRow[] {
  const q = db
    .select()
    .from(workenvEvents)
    .where(eq(workenvEvents.workenvId, workenvId))
    .orderBy(desc(workenvEvents.createdAt))
  return opts.limit != null ? q.limit(opts.limit).all() : q.all()
}
