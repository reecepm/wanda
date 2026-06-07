import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Layer, ManagedRuntime } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../../db/migrate'
import * as schema from '../../../db/schema'
import * as taskSchema from '../../../db/task-schema'
import { DatabaseService } from '../../../infra/database'
import { makeTestBroadcasterLayer } from '../../../testing/broadcaster-tracker'
import { PlanController, PlanControllerLive } from '../controller'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema: { ...schema, ...taskSchema } })
  runMigrations(db, join(__dirname, '../../../db/migrations'))
  db.insert(schema.workspaces).values({ id: 'ws-1', name: 'Workspace', cwd: '/tmp/ws' }).run()
  return db
}

function setup() {
  const dbLayer = Layer.sync(DatabaseService, makeDb)
  const { layer: broadcasterLayer, tracker } = makeTestBroadcasterLayer()
  const layer = PlanControllerLive.pipe(Layer.provideMerge(Layer.mergeAll(dbLayer, broadcasterLayer)))
  return { runtime: ManagedRuntime.make(layer), tracker }
}

describe('PlanController', () => {
  let runtime: ReturnType<typeof setup>['runtime']
  let tracker: ReturnType<typeof setup>['tracker']

  beforeEach(() => {
    ;({ runtime, tracker } = setup())
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it('creates plans with unique slugs, initial revisions, and broadcasts creation', async () => {
    const plans = await runtime.runPromise(PlanController)

    const first = await runtime.runPromise(
      plans.create({
        workspaceId: 'ws-1',
        title: 'Demo Plan',
        kind: 'task-plan',
        body: 'Initial body',
        links: [{ kind: 'pod', refId: 'pod-1', label: 'Pod' }],
      }),
    )
    const second = await runtime.runPromise(
      plans.create({
        workspaceId: 'ws-1',
        title: 'Demo Plan',
        kind: 'task-plan',
        body: 'Second body',
      }),
    )

    expect(first.slug).toBe('demo-plan')
    expect(second.slug).toBe('demo-plan-2')
    expect(first.status).toBe('draft')

    const revisions = await runtime.runPromise(plans.listRevisions({ planId: first.id }))
    expect(revisions).toHaveLength(1)
    const meta = await runtime.runPromise(plans.get(first.id))
    expect(meta?.links).toHaveLength(1)
    expect(tracker.sends.some((send) => send.channel === 'plan.created' && send.args[0] === first.id)).toBe(true)
  })

  it('updates through expected version and records a revision', async () => {
    const plans = await runtime.runPromise(PlanController)
    const created = await runtime.runPromise(
      plans.create({
        workspaceId: 'ws-1',
        title: 'Editable',
        kind: 'prd',
        body: 'v1',
      }),
    )

    const updated = await runtime.runPromise(
      plans.update({
        id: created.id,
        expectedVersion: created.version,
        body: 'v2',
        summary: 'revise body',
      }),
    )

    expect(updated.version).toBe(2)
    expect(updated.body).toBe('v2')
    const revisions = await runtime.runPromise(plans.listRevisions({ planId: created.id }))
    expect(revisions.map((revision) => revision.summary)).toEqual(['revise body', 'created'])
    expect(tracker.sends.some((send) => send.channel === 'plan.updated' && send.args[0] === created.id)).toBe(true)
  })

  it('adds, updates, and removes feedback comments', async () => {
    const plans = await runtime.runPromise(PlanController)
    const plan = await runtime.runPromise(
      plans.create({
        workspaceId: 'ws-1',
        title: 'Commented',
        kind: 'task-plan',
        body: 'body',
      }),
    )

    const comment = await runtime.runPromise(
      plans.addComment({
        planId: plan.id,
        body: 'Needs more detail',
        includeInFeedback: true,
      }),
    )
    const updated = await runtime.runPromise(
      plans.updateComment({
        commentId: comment.id,
        body: 'Looks good now',
        resolved: true,
      }),
    )
    const removed = await runtime.runPromise(plans.removeComment(comment.id))

    expect(updated.body).toBe('Looks good now')
    expect(updated.resolvedAt).not.toBeNull()
    expect(removed).toEqual({ removed: true })
    expect(await runtime.runPromise(plans.listComments(plan.id))).toEqual([])
  })
})
