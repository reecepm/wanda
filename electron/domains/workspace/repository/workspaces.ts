import { asc, eq } from 'drizzle-orm'
import type { AppDatabase } from '../../../db/connection'
import { insertAndReturn } from '../../../db/helpers'
import { workspaces } from '../../../db/schema'

export type WorkspaceRow = typeof workspaces.$inferSelect
export type WorkspaceUpdateInput = Partial<
  Pick<typeof workspaces.$inferInsert, 'name' | 'cwd' | 'repoPath' | 'iconUrl' | 'sortOrder'>
>

export function listWorkspaces(db: AppDatabase) {
  return db.select().from(workspaces).orderBy(asc(workspaces.sortOrder)).all()
}

export function getWorkspaceById(db: AppDatabase, id: string) {
  return db.select().from(workspaces).where(eq(workspaces.id, id)).get()
}

export function createWorkspace(
  db: AppDatabase,
  input: { name: string; cwd: string; repoPath?: string; iconUrl?: string | null },
) {
  return insertAndReturn(db, workspaces, input) as WorkspaceRow
}

export function updateWorkspace(db: AppDatabase, id: string, input: WorkspaceUpdateInput) {
  db.update(workspaces)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(workspaces.id, id))
    .run()
  return db.select().from(workspaces).where(eq(workspaces.id, id)).get()!
}

export function deleteWorkspace(db: AppDatabase, id: string) {
  db.delete(workspaces).where(eq(workspaces.id, id)).run()
}
