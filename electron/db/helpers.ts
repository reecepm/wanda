import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { v4 as uuid } from 'uuid'
import type { AppDatabase } from './connection'

/**
 * Any Drizzle SQLite table exposing an `id` column at the top level.
 * We structurally match on that runtime contract rather than the full
 * Drizzle generic envelope — the full type is too narrow to accept
 * concrete `sqliteTable(...)` outputs without intermediate casts.
 */
type TableWithId = SQLiteTable & { id: SQLiteColumn }

/**
 * Insert a row with a generated UUID and return the inserted row.
 * Encapsulates the common pattern: generate id, insert, select-by-id.
 */
export function insertAndReturn<T extends TableWithId>(
  db: AppDatabase,
  table: T,
  values: Omit<InferInsertModel<T>, 'id'>,
): InferSelectModel<T> {
  const id = uuid()
  db.insert(table)
    .values({ id, ...values } as InferInsertModel<T>)
    .run()
  return db.select().from(table).where(eq(table.id, id)).get()! as InferSelectModel<T>
}
