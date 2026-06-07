import { eq } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import type { AppDatabase } from '../../../db/connection'
import { podItems, pods, podTerminals, settings, views } from '../../../db/schema'
import type { ViewItemSettings } from '../../view/types'
import type { PodItemConfig } from '../types'

const VIEW_SYSTEM_V2_MIGRATION_KEY = 'migration.viewSystemV2.complete'

export type PodItemRow = typeof podItems.$inferSelect

export type PodItemUpdateInput = Partial<Pick<typeof podItems.$inferInsert, 'label' | 'labelSource' | 'sortOrder'>>

export function listItemsByPod(db: AppDatabase, podId: string) {
  return db.select().from(podItems).where(eq(podItems.podId, podId)).orderBy(podItems.sortOrder).all()
}

export function getItemById(db: AppDatabase, id: string) {
  return db.select().from(podItems).where(eq(podItems.id, id)).get()
}

export function insertItem(
  db: AppDatabase,
  input: {
    podId: string
    contentType: string
    label: string
    labelSource?: string
    config: PodItemConfig
    sortOrder?: number
  },
) {
  const id = uuid()
  db.insert(podItems)
    .values({
      id,
      podId: input.podId,
      contentType: input.contentType,
      label: input.label,
      labelSource: input.labelSource ?? 'default',
      config: input.config,
      sortOrder: input.sortOrder ?? 0,
    })
    .run()
  return db.select().from(podItems).where(eq(podItems.id, id)).get()!
}

export function updateItem(
  db: AppDatabase,
  id: string,
  input: Partial<Pick<typeof podItems.$inferInsert, 'label' | 'labelSource' | 'sortOrder' | 'config'>>,
) {
  db.update(podItems)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(podItems.id, id))
    .run()
  return db.select().from(podItems).where(eq(podItems.id, id)).get()!
}

export function deleteItem(db: AppDatabase, id: string) {
  db.delete(podItems).where(eq(podItems.id, id)).run()
}

export function getAllItems(db: AppDatabase) {
  return db.select().from(podItems).all()
}

export function runViewSystemV2Migration(db: AppDatabase): boolean {
  const migrationDone = db.select().from(settings).where(eq(settings.key, VIEW_SYSTEM_V2_MIGRATION_KEY)).get()
  if (migrationDone?.value) return false

  const allPods = db.select().from(pods).all()
  for (const pod of allPods) {
    const terminals = db.select().from(podTerminals).where(eq(podTerminals.podId, pod.id)).all()
    const existingItems = listItemsByPod(db, pod.id)
    const existingTerminalIds = new Set(
      existingItems
        .filter((item) => item.contentType === 'terminal')
        .map((item) => ('podTerminalId' in item.config ? item.config.podTerminalId : '')),
    )

    for (const terminal of terminals) {
      if (!existingTerminalIds.has(terminal.id)) {
        insertItem(db, {
          podId: pod.id,
          contentType: 'terminal',
          label: terminal.name,
          labelSource: 'default',
          config: { podTerminalId: terminal.id },
          sortOrder: terminal.sortOrder,
        })
      }
    }

    const podViews = db.select().from(views).where(eq(views.podId, pod.id)).all()
    if (podViews.length === 0) {
      const items = listItemsByPod(db, pod.id)
      const itemSettings: Record<string, ViewItemSettings> = {}
      for (const item of items) {
        itemSettings[item.id] = { sortOrder: item.sortOrder }
      }

      const viewId = uuid()
      db.insert(views)
        .values({
          id: viewId,
          podId: pod.id,
          name: 'Default',
          viewType: 'tabs',
          config: { type: 'tabs' },
          itemSettings,
        })
        .run()
      db.update(pods).set({ activeViewId: viewId, updatedAt: new Date() }).where(eq(pods.id, pod.id)).run()
    } else if (podViews.length === 1 && podViews[0] && !pod.activeViewId) {
      db.update(pods).set({ activeViewId: podViews[0].id, updatedAt: new Date() }).where(eq(pods.id, pod.id)).run()
    }
  }

  db.insert(settings)
    .values({ key: VIEW_SYSTEM_V2_MIGRATION_KEY, value: 'true', updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } })
    .run()

  return true
}
