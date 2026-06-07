import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../../../db/connection'
import { settings } from '../../../db/schema'

export function getContainerLifecycleDefault(db: AppDatabase): string | null {
  return db.select().from(settings).where(eq(settings.key, 'container.lifecycle')).get()?.value ?? null
}
