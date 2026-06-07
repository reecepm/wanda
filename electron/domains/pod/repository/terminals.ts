import { asc, eq } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import type { AppDatabase } from '../../../db/connection'
import { podTerminals } from '../../../db/schema'

export type PodTerminalRow = typeof podTerminals.$inferSelect

export type PodTerminalUpdateInput = Partial<
  Pick<typeof podTerminals.$inferInsert, 'name' | 'command' | 'args' | 'env' | 'restartPolicy' | 'sortOrder'>
>

export function listTerminalsByPod(db: AppDatabase, podId: string) {
  return db.select().from(podTerminals).where(eq(podTerminals.podId, podId)).orderBy(asc(podTerminals.sortOrder)).all()
}

export function getTerminalById(db: AppDatabase, id: string) {
  return db.select().from(podTerminals).where(eq(podTerminals.id, id)).get()
}

export function insertTerminal(
  db: AppDatabase,
  input: {
    podId: string
    name: string
    command?: string
    args?: string[]
    env?: Record<string, string>
    restartPolicy?: 'never' | 'on-failure' | 'always'
    sortOrder?: number
  },
) {
  const id = uuid()
  db.insert(podTerminals)
    .values({ id, ...input, sortOrder: input.sortOrder ?? 0 })
    .run()
  return db.select().from(podTerminals).where(eq(podTerminals.id, id)).get()!
}

export function updateTerminal(db: AppDatabase, id: string, input: PodTerminalUpdateInput) {
  db.update(podTerminals)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(podTerminals.id, id))
    .run()
  return db.select().from(podTerminals).where(eq(podTerminals.id, id)).get()!
}

export function deleteTerminal(db: AppDatabase, id: string) {
  db.delete(podTerminals).where(eq(podTerminals.id, id)).run()
}
