import { Context, Effect, Layer } from 'effect'
import { type AppDatabase, createDatabase } from '../db/connection'
import { runMigrations } from '../db/migrate'

export class DatabaseService extends Context.Tag('DatabaseService')<DatabaseService, AppDatabase>() {}

/**
 * Runtime configuration for DatabaseServiceLive. Must be supplied by the
 * shell (or standalone server entry) via `configureDatabase` before any code
 * resolves `DatabaseService`. Kept as module-level mutable state to match the
 * existing pattern used by `Broadcaster` (see electron/infra/broadcaster.ts).
 */
interface DatabaseConfig {
  readonly dbPath: string
  readonly migrationsFolder: string
}

let databaseConfig: DatabaseConfig | null = null

/**
 * Configure the database paths used by `DatabaseServiceLive`. Must be called
 * before `DatabaseService` is resolved from the runtime.
 */
export function configureDatabase(config: DatabaseConfig): void {
  databaseConfig = config
}

export const DatabaseServiceLive = Layer.effect(
  DatabaseService,
  Effect.sync(() => {
    if (!databaseConfig) {
      throw new Error(
        'configureDatabase() must be called before resolving DatabaseService. ' +
          'The shell / server entry is responsible for supplying dbPath and migrationsFolder.',
      )
    }
    const db = createDatabase(databaseConfig.dbPath)
    runMigrations(db, databaseConfig.migrationsFolder)
    return db
  }),
)
