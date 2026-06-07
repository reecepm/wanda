import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { AppDatabase } from '../../../db/connection'
import { pods } from '../../../db/schema'
import type { PodGitContext, PodRuntime } from '../types'

export type PodRow = typeof pods.$inferSelect
export type PodStatus = PodRow['status']

export type PodUpdateInput = Partial<
  Pick<
    typeof pods.$inferInsert,
    'name' | 'cwd' | 'shell' | 'env' | 'sortOrder' | 'runtime' | 'containerLifecycle' | 'workspaceId' | 'wandaMcpPolicy'
  >
>

export function listPodsByWorkspace(db: AppDatabase, workspaceId: string) {
  return db
    .select()
    .from(pods)
    .where(and(eq(pods.workspaceId, workspaceId), eq(pods.isTemplate, false)))
    .orderBy(asc(pods.sortOrder))
    .all()
}

export function getPodById(db: AppDatabase, id: string) {
  return db.select().from(pods).where(eq(pods.id, id)).get()
}

export function getAllPods(db: AppDatabase) {
  return db.select().from(pods).all()
}

export function listPodsByWorkenv(db: AppDatabase, workenvId: string): PodRow[] {
  return db.select().from(pods).where(eq(pods.workenvId, workenvId)).all()
}

export function listPodsWithContainerId(db: AppDatabase): PodRow[] {
  return db.select().from(pods).where(isNotNull(pods.containerId)).all()
}

export function listRunningPods(db: AppDatabase): PodRow[] {
  return db.select().from(pods).where(eq(pods.status, 'running')).all()
}

export function countPodsByStatus(db: AppDatabase, status: PodStatus): number {
  return db.select().from(pods).where(eq(pods.status, status)).all().length
}

export function getPodNameById(db: AppDatabase, id: string): string | undefined {
  return db.select({ name: pods.name }).from(pods).where(eq(pods.id, id)).get()?.name
}

export function insertPod(
  db: AppDatabase,
  input: {
    id: string
    workspaceId: string
    name: string
    cwd: string
    shell?: string
    env?: Record<string, string>
    runtime?: PodRuntime
    sliceBranch?: string
    containerLifecycle?: string
    gitContext?: PodGitContext | null
    wandaMcpPolicy?: 'inherit' | 'include' | 'exclude' | null
  },
) {
  db.insert(pods).values(input).run()
  return db.select().from(pods).where(eq(pods.id, input.id)).get()!
}

export function updatePod(db: AppDatabase, id: string, input: Partial<typeof pods.$inferInsert>) {
  db.update(pods)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(pods.id, id))
    .run()
  return db.select().from(pods).where(eq(pods.id, id)).get()!
}

export function deletePod(db: AppDatabase, id: string) {
  db.delete(pods).where(eq(pods.id, id)).run()
}

export function setActivePodView(db: AppDatabase, podId: string, viewId: string | null) {
  return updatePod(db, podId, { activeViewId: viewId })
}

export function setPodStatus(db: AppDatabase, podId: string, status: PodStatus): void {
  db.update(pods).set({ status, updatedAt: new Date() }).where(eq(pods.id, podId)).run()
}

export function resetStaleLocalPodStatuses(db: AppDatabase): void {
  for (const status of ['running', 'starting', 'stopping'] as const) {
    db.update(pods)
      .set({ status: 'stopped', updatedAt: new Date() })
      .where(and(eq(pods.status, status), isNull(pods.containerId)))
      .run()
  }
}

export function setPodWorkenv(db: AppDatabase, id: string, workenvId: string | null): PodRow | undefined {
  return updatePod(db, id, { workenvId })
}

export function setPodGitContext(db: AppDatabase, id: string, gitContext: PodGitContext | null): PodRow | undefined {
  return updatePod(db, id, { gitContext })
}

export function setPodContainerId(db: AppDatabase, id: string, containerId: string): PodRow | undefined {
  return updatePod(db, id, { containerId })
}

export function clearPodContainerState(db: AppDatabase, id: string): void {
  db.update(pods)
    .set({ containerId: null, resolvedPorts: null, detectedPorts: null, updatedAt: new Date() })
    .where(eq(pods.id, id))
    .run()
}

export function clearPodResolvedPorts(db: AppDatabase, id: string): void {
  db.update(pods).set({ resolvedPorts: null, detectedPorts: null, updatedAt: new Date() }).where(eq(pods.id, id)).run()
}

export function markPodStoppedAndClearContainer(db: AppDatabase, id: string): void {
  db.update(pods).set({ containerId: null, status: 'stopped', updatedAt: new Date() }).where(eq(pods.id, id)).run()
}
