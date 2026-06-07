import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import * as taskSchema from './task-schema'

export function createDatabase(dbPath: string) {
  const sqlite = new Database(dbPath)

  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  // NORMAL is the recommended durability level under WAL (safe across app
  // crashes; only a power loss can lose the last commit). busy_timeout lets
  // writers wait out a transient lock instead of failing with SQLITE_BUSY.
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 30000')

  return drizzle(sqlite, { schema: { ...schema, ...taskSchema } })
}

export type AppDatabase = ReturnType<typeof createDatabase>
