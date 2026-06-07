import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../../../db/connection'
import { views } from '../../../db/schema'
import type { ViewConfig } from '../../view/types'

export function updateTemplateDefaultView(
  db: AppDatabase,
  input: { podId: string; viewType: ViewConfig['type']; config: ViewConfig },
) {
  db.update(views)
    .set({
      viewType: input.viewType,
      config: input.config,
      updatedAt: new Date(),
    })
    .where(eq(views.podId, input.podId))
    .run()
}
