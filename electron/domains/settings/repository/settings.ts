import { eq, inArray } from 'drizzle-orm'
import type { AppDatabase } from '../../../db/connection'
import { settings } from '../../../db/schema'

export function getSetting(db: AppDatabase, key: string) {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  return row?.value ?? null
}

export function getManySettings(db: AppDatabase, keys: string[]) {
  if (keys.length === 0) return {} satisfies Record<string, string | null>
  const rows = db.select().from(settings).where(inArray(settings.key, keys)).all()
  const result: Record<string, string | null> = {}
  for (const k of keys) result[k] = null
  for (const row of rows) result[row.key] = row.value
  return result
}

export function setSetting(db: AppDatabase, key: string, value: string | null) {
  if (value === null) {
    db.delete(settings).where(eq(settings.key, key)).run()
  } else {
    db.insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
      .run()
  }
}
