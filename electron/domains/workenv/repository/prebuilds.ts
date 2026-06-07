import { eq } from 'drizzle-orm'
import type { WorkenvConfig, WorkenvRuntime } from '../../../../shared/contracts/workenv'
import type { WorkenvRuntimeState } from '../../../../shared/contracts/workenv-runtime-state'
import type { AppDatabase } from '../../../db/connection'
import { workenvPrebuilds } from '../../../db/schema'

type WorkenvPrebuildRow = typeof workenvPrebuilds.$inferSelect

export function listPrebuilds(db: AppDatabase): WorkenvPrebuildRow[] {
  return db.select().from(workenvPrebuilds).all()
}

export function getPrebuildById(db: AppDatabase, id: string): WorkenvPrebuildRow | undefined {
  return db.select().from(workenvPrebuilds).where(eq(workenvPrebuilds.id, id)).get()
}

export function adoptPrebuildCacheKey(db: AppDatabase, fromId: string, hash: string): WorkenvPrebuildRow | undefined {
  db.update(workenvPrebuilds)
    .set({ id: hash, configHash: hash, updatedAt: new Date() })
    .where(eq(workenvPrebuilds.id, fromId))
    .run()
  return getPrebuildById(db, hash)
}

export function markPrebuildMissingRuntime(db: AppDatabase, hash: string, message: string): void {
  db.update(workenvPrebuilds)
    .set({
      state: 'creating',
      adapterHandle: null,
      runtimeState: null,
      lastError: message,
      updatedAt: new Date(),
    })
    .where(eq(workenvPrebuilds.id, hash))
    .run()
}

export function createPrebuild(
  db: AppDatabase,
  input: {
    hash: string
    runtime: WorkenvRuntime
    config: WorkenvConfig
  },
): void {
  const now = new Date()
  db.insert(workenvPrebuilds)
    .values({
      id: input.hash,
      runtime: input.runtime,
      configHash: input.hash,
      state: 'creating',
      config: input.config,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

export function resetPrebuildBuild(db: AppDatabase, hash: string, config: WorkenvConfig): void {
  db.update(workenvPrebuilds)
    .set({
      state: 'creating',
      config,
      configHash: hash,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(workenvPrebuilds.id, hash))
    .run()
}

export function updatePrebuildHandle(
  db: AppDatabase,
  hash: string,
  input: {
    adapterHandle: string
    runtimeState: WorkenvRuntimeState
  },
): void {
  db.update(workenvPrebuilds)
    .set({
      adapterHandle: input.adapterHandle,
      runtimeState: input.runtimeState,
      updatedAt: new Date(),
    })
    .where(eq(workenvPrebuilds.id, hash))
    .run()
}

export function markPrebuildError(db: AppDatabase, hash: string, lastError: string): void {
  db.update(workenvPrebuilds)
    .set({ state: 'error', lastError, updatedAt: new Date() })
    .where(eq(workenvPrebuilds.id, hash))
    .run()
}

export function markPrebuildReady(db: AppDatabase, hash: string): void {
  db.update(workenvPrebuilds)
    .set({ state: 'ready', lastError: null, updatedAt: new Date() })
    .where(eq(workenvPrebuilds.id, hash))
    .run()
}
