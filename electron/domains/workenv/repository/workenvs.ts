// -----------------------------------------------------------------------------
// Workenv repository — thin Drizzle wrapper. Validation, state-machine
// guards, and event emission live in the controller; this layer only
// knows about rows.
// -----------------------------------------------------------------------------

import { eq } from 'drizzle-orm'
import type {
  WorkenvConfig,
  WorkenvResolvedPort,
  WorkenvRuntime,
  WorkenvState,
} from '../../../../shared/contracts/workenv'
import type { WorkenvRuntimeState } from '../../../../shared/contracts/workenv-runtime-state'
import type { AppDatabase } from '../../../db/connection'
import { insertAndReturn } from '../../../db/helpers'
import { pods, workenvs } from '../../../db/schema'

export type WorkenvRow = typeof workenvs.$inferSelect

interface CreateWorkenvInput {
  readonly name: string
  readonly slug: string
  readonly worktreePath: string
  readonly runtime: WorkenvRuntime
  readonly configHash: string
  readonly config: WorkenvConfig
  readonly state?: WorkenvState
  readonly adapterHandle?: string | null
  readonly templateId?: string | null
  readonly runtimeState?: WorkenvRuntimeState | null
  readonly resolvedPorts?: WorkenvResolvedPort[] | null
}

type UpdateWorkenvInput = Partial<
  Pick<
    typeof workenvs.$inferInsert,
    | 'name'
    | 'state'
    | 'adapterHandle'
    | 'configHash'
    | 'config'
    | 'runtimeState'
    | 'resolvedPorts'
    | 'templateId'
    | 'worktreePath'
    | 'lastError'
    | 'lastHealthyAt'
    | 'lastStartedAt'
    | 'lastStoppedAt'
  >
>

export function listWorkenvs(db: AppDatabase): WorkenvRow[] {
  return db.select().from(workenvs).all()
}

export function getWorkenvById(db: AppDatabase, id: string): WorkenvRow | undefined {
  return db.select().from(workenvs).where(eq(workenvs.id, id)).get()
}

export function getWorkenvBySlug(db: AppDatabase, slug: string): WorkenvRow | undefined {
  return db.select().from(workenvs).where(eq(workenvs.slug, slug)).get()
}

export function createWorkenv(db: AppDatabase, input: CreateWorkenvInput): WorkenvRow {
  return insertAndReturn(db, workenvs, input)
}

export function updateWorkenv(db: AppDatabase, id: string, input: UpdateWorkenvInput): WorkenvRow {
  db.update(workenvs)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(workenvs.id, id))
    .run()
  return getWorkenvById(db, id)!
}

export function deleteWorkenv(db: AppDatabase, id: string): void {
  db.delete(workenvs).where(eq(workenvs.id, id)).run()
}

export function deletePodsAttachedToWorkenv(db: AppDatabase, workenvId: string): void {
  const attached = db.select().from(pods).where(eq(pods.workenvId, workenvId)).all()
  for (const pod of attached) {
    db.delete(pods).where(eq(pods.id, pod.id)).run()
  }
}
