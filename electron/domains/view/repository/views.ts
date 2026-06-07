import { eq } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import type { AppDatabase } from '../../../db/connection'
import { podItems, pods, views } from '../../../db/schema'
import type { ViewConfig, ViewItemSettings } from '../types'

export type ViewRow = typeof views.$inferSelect
export type ViewUpdateInput = Partial<Pick<typeof views.$inferInsert, 'name' | 'config' | 'itemSettings' | 'sortOrder'>>

export function listViewsByPod(db: AppDatabase, podId: string) {
  return db.select().from(views).where(eq(views.podId, podId)).all()
}

export function getViewById(db: AppDatabase, id: string) {
  return db.select().from(views).where(eq(views.id, id)).get()
}

export function createView(
  db: AppDatabase,
  input: {
    podId: string
    name: string
    viewType?: string
    config?: ViewConfig
    itemSettings?: Record<string, ViewItemSettings>
    sortOrder?: number
  },
) {
  const id = uuid()
  db.insert(views)
    .values({
      id,
      podId: input.podId,
      name: input.name,
      viewType: input.viewType ?? 'tabs',
      config: input.config,
      itemSettings: input.itemSettings ?? {},
      sortOrder: input.sortOrder ?? 0,
    })
    .run()
  return db.select().from(views).where(eq(views.id, id)).get()!
}

export function updateView(db: AppDatabase, id: string, input: ViewUpdateInput) {
  db.update(views)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(views.id, id))
    .run()
  return db.select().from(views).where(eq(views.id, id)).get()!
}

export function deleteView(db: AppDatabase, id: string) {
  db.delete(views).where(eq(views.id, id)).run()
}

export function listPodItems(db: AppDatabase, podId: string) {
  return db.select().from(podItems).where(eq(podItems.podId, podId)).all()
}

export function setActivePodView(db: AppDatabase, podId: string, viewId: string) {
  db.update(pods).set({ activeViewId: viewId, updatedAt: new Date() }).where(eq(pods.id, podId)).run()
}
