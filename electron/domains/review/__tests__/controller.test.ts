import { createHash } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../../db/migrate'
import * as schema from '../../../db/schema'
import * as taskSchema from '../../../db/task-schema'
import { DatabaseService } from '../../../infra/database'
import { PodController, type PodControllerShape } from '../../pod/controller/pod'
import { ReviewController, ReviewControllerLive } from '../controller'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema: { ...schema, ...taskSchema } })
  runMigrations(db, join(__dirname, '../../../db/migrations'))
  db.insert(schema.workspaces).values({ id: 'ws-1', name: 'Workspace', cwd: '/repo' }).run()
  const podRow: typeof schema.pods.$inferInsert = {
    id: 'pod-1',
    workspaceId: 'ws-1',
    name: 'Pod',
    cwd: '/repo',
    status: 'stopped',
    gitContext: { repoPath: '/repo', baseRef: 'main', source: 'user' },
  }
  db.insert(schema.pods).values(podRow).run()
  return db
}

function setup() {
  const dbLayer = Layer.sync(DatabaseService, makeDb)
  const podSvc: Partial<PodControllerShape> = {
    getById: (id) =>
      Effect.succeed(
        id === 'pod-1'
          ? ({
              id: 'pod-1',
              workspaceId: 'ws-1',
              name: 'Pod',
              cwd: '/repo',
              status: 'stopped',
              gitContext: { repoPath: '/repo', baseRef: 'main', source: 'user' },
            } as never)
          : undefined,
      ),
  }
  const podLayer = Layer.succeed(PodController, podSvc as PodControllerShape)
  const layer = ReviewControllerLive.pipe(Layer.provideMerge(Layer.mergeAll(dbLayer, podLayer)))
  return ManagedRuntime.make(layer)
}

describe('ReviewController', () => {
  let runtime: ReturnType<typeof setup>

  beforeEach(() => {
    runtime = setup()
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it('creates one draft review per pod and returns the existing draft', async () => {
    const reviews = await runtime.runPromise(ReviewController)

    const first = await runtime.runPromise(reviews.getOrCreateDraft({ podId: 'pod-1', baseRef: 'main' }))
    const second = await runtime.runPromise(reviews.getOrCreateDraft({ podId: 'pod-1', baseRef: 'other' }))

    expect(second.id).toBe(first.id)
    expect(second.baseRef).toBe('main')
    expect(await runtime.runPromise(reviews.listReviews('pod-1'))).toHaveLength(1)
  })

  it('adds, updates, and removes draft comments with anchor hashes', async () => {
    const reviews = await runtime.runPromise(ReviewController)
    const review = await runtime.runPromise(reviews.getOrCreateDraft({ podId: 'pod-1' }))

    const comment = await runtime.runPromise(
      reviews.addComment({
        reviewId: review.id,
        filePath: 'src/app.ts',
        side: 'additions',
        startLine: 4,
        body: 'Please simplify this',
        anchorContent: 'const value = 1',
      }),
    )
    const updated = await runtime.runPromise(reviews.updateComment(comment.id, 'Resolved locally'))
    const removed = await runtime.runPromise(reviews.removeComment(comment.id))

    expect(comment.anchorHash).toBe(createHash('sha256').update('const value = 1').digest('hex'))
    expect(updated.body).toBe('Resolved locally')
    expect(removed).toEqual({ removed: true })
    expect(await runtime.runPromise(reviews.listComments(review.id))).toEqual([])
  })

  it('submits a draft review and records the current git head when shell exec is available', async () => {
    const reviews = await runtime.runPromise(ReviewController)
    const review = await runtime.runPromise(reviews.getOrCreateDraft({ podId: 'pod-1' }))

    const submitted = await runtime.runPromise(
      reviews.submitReview({ reviewId: review.id, summary: 'Ready' }, () => async ({ command }) => ({
        stdout: command.includes('rev-parse HEAD') ? 'abc123\n' : '',
        stderr: '',
        exitCode: 0,
      })),
    )

    expect(submitted.state).toBe('submitted')
    expect(submitted.summary).toBe('Ready')
    expect(submitted.headCommit).toBe('abc123')
  })
})
