import { and, eq } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import type { AppDatabase } from '../../../db/connection'
import { podCommands, podItems, pods, podTerminals, workspaces, workspaceViews } from '../../../db/schema'
import type { ViewConfig } from '../../view/types'

export type WorkspaceViewRow = typeof workspaceViews.$inferSelect
export type WorkspaceViewUpdateInput = Partial<
  Pick<typeof workspaceViews.$inferInsert, 'name' | 'config' | 'itemSettings' | 'sortOrder'>
>
export type AggregatedItems = ReturnType<typeof listAggregatedItems>
export type AggregatedTerminalConfigs = ReturnType<typeof listAggregatedTerminalConfigs>
export type AggregatedCommandConfigs = ReturnType<typeof listAggregatedCommandConfigs>

export function listViewsByWorkspace(db: AppDatabase, workspaceId: string) {
  return db.select().from(workspaceViews).where(eq(workspaceViews.workspaceId, workspaceId)).all()
}

export function getWorkspaceViewById(db: AppDatabase, id: string) {
  return db.select().from(workspaceViews).where(eq(workspaceViews.id, id)).get()
}

export function createWorkspaceView(
  db: AppDatabase,
  input: {
    workspaceId: string
    name: string
    viewType?: string
    config?: ViewConfig
    itemSettings?: Record<string, import('../../view/types').ViewItemSettings>
    sortOrder?: number
  },
) {
  const id = uuid()
  db.insert(workspaceViews)
    .values({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      viewType: input.viewType ?? 'columns',
      config: input.config,
      itemSettings: input.itemSettings ?? {},
      sortOrder: input.sortOrder ?? 0,
    })
    .run()
  return db.select().from(workspaceViews).where(eq(workspaceViews.id, id)).get()!
}

export function updateWorkspaceView(db: AppDatabase, id: string, input: WorkspaceViewUpdateInput) {
  db.update(workspaceViews)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(workspaceViews.id, id))
    .run()
  return db.select().from(workspaceViews).where(eq(workspaceViews.id, id)).get()!
}

export function deleteWorkspaceView(db: AppDatabase, id: string) {
  db.delete(workspaceViews).where(eq(workspaceViews.id, id)).run()
}

export function setActiveWorkspaceView(db: AppDatabase, workspaceId: string, viewId: string | null) {
  db.update(workspaces)
    .set({ activeWorkspaceViewId: viewId, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .run()
}

/** Fetch all terminal configs across all pods in a workspace. */
export function listAggregatedTerminalConfigs(db: AppDatabase, workspaceId: string) {
  return db
    .select()
    .from(podTerminals)
    .innerJoin(pods, eq(podTerminals.podId, pods.id))
    .where(and(eq(pods.workspaceId, workspaceId), eq(pods.isTemplate, false)))
    .all()
    .map((row) => row.pod_terminals)
}

/** Fetch all command configs across all pods in a workspace. */
export function listAggregatedCommandConfigs(db: AppDatabase, workspaceId: string) {
  return db
    .select()
    .from(podCommands)
    .innerJoin(pods, eq(podCommands.podId, pods.id))
    .where(and(eq(pods.workspaceId, workspaceId), eq(pods.isTemplate, false)))
    .all()
    .map((row) => row.pod_commands)
}

/** Fetch all pod items across all pods in a workspace, annotated with pod metadata. */
export function listAggregatedItems(db: AppDatabase, workspaceId: string) {
  return db
    .select({
      id: podItems.id,
      podId: podItems.podId,
      contentType: podItems.contentType,
      label: podItems.label,
      labelSource: podItems.labelSource,
      config: podItems.config,
      sortOrder: podItems.sortOrder,
      podName: pods.name,
      podStatus: pods.status,
      podSortOrder: pods.sortOrder,
    })
    .from(podItems)
    .innerJoin(pods, eq(podItems.podId, pods.id))
    .where(and(eq(pods.workspaceId, workspaceId), eq(pods.isTemplate, false)))
    .all()
}
