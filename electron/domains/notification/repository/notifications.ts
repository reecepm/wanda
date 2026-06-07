import { desc, eq, isNull, sql } from 'drizzle-orm'
import type { AppDatabase } from '../../../db/connection'
import { insertAndReturn } from '../../../db/helpers'
import { notifications, pods } from '../../../db/schema'

export type NotificationRow = typeof notifications.$inferSelect

export function insertNotification(
  db: AppDatabase,
  input: {
    type: (typeof notifications.$inferSelect)['type']
    priority: (typeof notifications.$inferSelect)['priority']
    podId: string | null
    podTerminalId: string | null
    workspaceId: string | null
    title: string
    body: string | null
    payload: Record<string, unknown> | null
  },
) {
  return insertAndReturn(db, notifications, input) as NotificationRow
}

export function resolveWorkspaceFromPod(db: AppDatabase, podId: string) {
  return db.select({ workspaceId: pods.workspaceId }).from(pods).where(eq(pods.id, podId)).get()
}

export function resolveNotification(db: AppDatabase, id: string, resolution: string) {
  db.update(notifications).set({ resolvedAt: new Date(), resolution }).where(eq(notifications.id, id)).run()
}

export function listUnresolvedNotifications(db: AppDatabase) {
  return db.select().from(notifications).where(isNull(notifications.resolvedAt)).all()
}

export function resolveNotificationsByIds(db: AppDatabase, ids: string[], resolution: string) {
  const now = new Date()
  for (const id of ids) {
    db.update(notifications).set({ resolvedAt: now, resolution }).where(eq(notifications.id, id)).run()
  }
}

export function dismissAllNotifications(db: AppDatabase) {
  const now = new Date()
  const result = db
    .update(notifications)
    .set({ resolvedAt: now, resolution: 'dismissed' })
    .where(isNull(notifications.resolvedAt))
    .run()
  return result.changes
}

export function markNotificationRead(db: AppDatabase, id: string) {
  db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id)).run()
}

export function listUnresolvedNotificationsOrdered(db: AppDatabase) {
  return db.select().from(notifications).where(isNull(notifications.resolvedAt)).orderBy(notifications.createdAt).all()
}

export function listRecentNotifications(db: AppDatabase, limit: number) {
  return db.select().from(notifications).orderBy(desc(notifications.createdAt), desc(sql`rowid`)).limit(limit).all()
}
