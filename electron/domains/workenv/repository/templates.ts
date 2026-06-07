// -----------------------------------------------------------------------------
// Workenv template repository.
// -----------------------------------------------------------------------------

import { asc, eq } from 'drizzle-orm'
import type { WorkenvConfig, WorkenvRuntime } from '../../../../shared/contracts/workenv'
import type { AppDatabase } from '../../../db/connection'
import { insertAndReturn } from '../../../db/helpers'
import { workenvTemplates, workspaceSettings } from '../../../db/schema'

export type WorkenvTemplateRow = typeof workenvTemplates.$inferSelect

export interface CreateTemplateInput {
  readonly id?: string
  readonly name: string
  readonly description?: string | null
  readonly runtime: WorkenvRuntime
  readonly config: Partial<WorkenvConfig>
  readonly builtIn?: boolean
  readonly sortOrder?: number
}

export type UpdateTemplateInput = Partial<
  Pick<typeof workenvTemplates.$inferInsert, 'name' | 'description' | 'runtime' | 'config' | 'builtIn' | 'sortOrder'>
>

export function listTemplates(db: AppDatabase): WorkenvTemplateRow[] {
  return db.select().from(workenvTemplates).orderBy(asc(workenvTemplates.sortOrder)).all()
}

export function getTemplateById(db: AppDatabase, id: string): WorkenvTemplateRow | undefined {
  return db.select().from(workenvTemplates).where(eq(workenvTemplates.id, id)).get()
}

export function createTemplate(db: AppDatabase, input: CreateTemplateInput): WorkenvTemplateRow {
  if (input.id) {
    db.insert(workenvTemplates)
      .values({
        id: input.id,
        name: input.name,
        description: input.description,
        runtime: input.runtime,
        config: input.config,
        builtIn: input.builtIn ?? false,
        sortOrder: input.sortOrder ?? 0,
      })
      .run()
    return getTemplateById(db, input.id)!
  }
  return insertAndReturn(db, workenvTemplates, input)
}

export function updateTemplate(db: AppDatabase, id: string, input: UpdateTemplateInput): WorkenvTemplateRow {
  db.update(workenvTemplates)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(workenvTemplates.id, id))
    .run()
  return getTemplateById(db, id)!
}

export function deleteTemplate(db: AppDatabase, id: string): void {
  db.update(workspaceSettings)
    .set({ defaultWorkenvTemplateId: null, updatedAt: new Date() })
    .where(eq(workspaceSettings.defaultWorkenvTemplateId, id))
    .run()
  db.delete(workenvTemplates).where(eq(workenvTemplates.id, id)).run()
}

export function seedBuiltInTemplates(db: AppDatabase, templates: readonly CreateTemplateInput[]): void {
  for (const template of templates) {
    if (!template.id) throw new Error('Built-in workenv templates must have stable ids')
    if (getTemplateById(db, template.id)) continue
    const now = new Date()
    db.insert(workenvTemplates)
      .values({
        id: template.id,
        name: template.name,
        description: template.description ?? null,
        runtime: template.runtime,
        config: template.config,
        builtIn: true,
        sortOrder: template.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }
}
