import { eq } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import type { AppDatabase } from '../../../db/connection'
import { taskViews } from '../../../db/schema'
import type { TaskViewConfig } from '../types'

export type TaskViewRow = typeof taskViews.$inferSelect
export type TaskViewUpdateInput = Partial<Pick<typeof taskViews.$inferInsert, 'name' | 'config' | 'sortOrder'>>

export function listTaskViews(db: AppDatabase) {
  return db.select().from(taskViews).all()
}

export function getTaskViewById(db: AppDatabase, id: string) {
  return db.select().from(taskViews).where(eq(taskViews.id, id)).get()
}

export function createTaskView(db: AppDatabase, input: { name: string; config: TaskViewConfig; sortOrder?: number }) {
  const id = uuid()
  db.insert(taskViews)
    .values({ id, name: input.name, config: input.config, sortOrder: input.sortOrder ?? 0 })
    .run()
  return db.select().from(taskViews).where(eq(taskViews.id, id)).get()!
}

export function updateTaskView(db: AppDatabase, id: string, input: TaskViewUpdateInput) {
  db.update(taskViews)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(taskViews.id, id))
    .run()
  return db.select().from(taskViews).where(eq(taskViews.id, id)).get()!
}

export function deleteTaskView(db: AppDatabase, id: string) {
  db.delete(taskViews).where(eq(taskViews.id, id)).run()
}
