import { join } from 'node:path'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../../../db/migrate'
import * as schema from '../../../../db/schema'
import * as taskSchema from '../../../../db/task-schema'
import {
  appendWorkenvEvent,
  createTemplate,
  createWorkenv,
  deleteTemplate,
  deleteWorkenv,
  getTemplateById,
  getWorkenvById,
  getWorkenvBySlug,
  listEventsForWorkenv,
  listTemplates,
  listWorkenvs,
  updateTemplate,
  updateWorkenv,
} from '..'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema: { ...schema, ...taskSchema } })
  runMigrations(db, join(__dirname, '../../../../db/migrations'))
  return db
}

describe('workenv repository', () => {
  let db: ReturnType<typeof makeDb>
  beforeEach(() => {
    db = makeDb()
  })

  // ------------------- workenvs -------------------

  it('createWorkenv inserts a row with defaults and returns it', () => {
    const w = createWorkenv(db, {
      name: 'demo',
      slug: 'demo',
      worktreePath: '/tmp/demo',
      runtime: 'orbstack',
      configHash: 'h0',
      config: { runtime: 'orbstack', worktreePath: '/tmp/demo' },
    })
    expect(w.id).toMatch(/.+/)
    expect(w.name).toBe('demo')
    expect(w.slug).toBe('demo')
    expect(w.runtime).toBe('orbstack')
    expect(w.state).toBe('creating') // schema default
    expect(w.adapterHandle).toBeNull()
    expect(w.createdAt).toBeInstanceOf(Date)
    expect(w.updatedAt).toBeInstanceOf(Date)
  })

  it('getWorkenvById returns the row or undefined', () => {
    const w = createWorkenv(db, {
      name: 'demo',
      slug: 'a',
      worktreePath: '/tmp/a',
      runtime: 'orbstack',
      configHash: 'h',
      config: { runtime: 'orbstack', worktreePath: '/tmp/a' },
    })
    expect(getWorkenvById(db, w.id)?.id).toBe(w.id)
    expect(getWorkenvById(db, 'missing')).toBeUndefined()
  })

  it('getWorkenvBySlug looks up by unique slug', () => {
    const w = createWorkenv(db, {
      name: 'demo',
      slug: 'unique-slug',
      worktreePath: '/tmp/u',
      runtime: 'orbstack',
      configHash: 'h',
      config: { runtime: 'orbstack', worktreePath: '/tmp/u' },
    })
    expect(getWorkenvBySlug(db, 'unique-slug')?.id).toBe(w.id)
    expect(getWorkenvBySlug(db, 'nope')).toBeUndefined()
  })

  it('listWorkenvs returns all rows', () => {
    expect(listWorkenvs(db)).toEqual([])
    createWorkenv(db, {
      name: 'a',
      slug: 'a',
      worktreePath: '/a',
      runtime: 'orbstack',
      configHash: 'h',
      config: { runtime: 'orbstack', worktreePath: '/a' },
    })
    createWorkenv(db, {
      name: 'b',
      slug: 'b',
      worktreePath: '/b',
      runtime: 'orbstack',
      configHash: 'h',
      config: { runtime: 'orbstack', worktreePath: '/b' },
    })
    const rows = listWorkenvs(db)
    expect(rows.map((r) => r.slug).sort()).toEqual(['a', 'b'])
  })

  it('updateWorkenv applies a partial patch and bumps updatedAt', async () => {
    const w = createWorkenv(db, {
      name: 'demo',
      slug: 'patch',
      worktreePath: '/p',
      runtime: 'orbstack',
      configHash: 'h0',
      config: { runtime: 'orbstack', worktreePath: '/p' },
    })
    const originalUpdatedAt = w.updatedAt.getTime()
    await new Promise((r) => setTimeout(r, 5))

    const patched = updateWorkenv(db, w.id, {
      state: 'running',
      adapterHandle: 'wanda-patch',
      lastStartedAt: new Date(),
    })

    expect(patched.state).toBe('running')
    expect(patched.adapterHandle).toBe('wanda-patch')
    expect(patched.lastStartedAt).toBeInstanceOf(Date)
    expect(patched.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt)
    // Untouched columns remain.
    expect(patched.slug).toBe('patch')
    expect(patched.configHash).toBe('h0')
  })

  it('deleteWorkenv removes the row', () => {
    const w = createWorkenv(db, {
      name: 'gone',
      slug: 'gone',
      worktreePath: '/g',
      runtime: 'orbstack',
      configHash: 'h',
      config: { runtime: 'orbstack', worktreePath: '/g' },
    })
    deleteWorkenv(db, w.id)
    expect(getWorkenvById(db, w.id)).toBeUndefined()
  })

  // ------------------- templates -------------------

  it('createTemplate / getTemplateById / listTemplates round-trip', () => {
    const t = createTemplate(db, {
      name: 'Ubuntu 24.04',
      runtime: 'orbstack',
      config: { runtime: 'orbstack' },
    })
    expect(t.id).toMatch(/.+/)
    expect(t.builtIn).toBe(false)
    expect(t.sortOrder).toBe(0)
    expect(getTemplateById(db, t.id)?.name).toBe('Ubuntu 24.04')

    createTemplate(db, {
      name: 'Debian 12',
      runtime: 'orbstack',
      config: { runtime: 'orbstack' },
      builtIn: true,
      sortOrder: 1,
    })
    expect(
      listTemplates(db)
        .map((r) => r.name)
        .sort(),
    ).toEqual(['Debian 12', 'Ubuntu 24.04'])
  })

  it('updateTemplate patches fields and bumps updatedAt', async () => {
    const t = createTemplate(db, {
      name: 'A',
      runtime: 'orbstack',
      config: { runtime: 'orbstack' },
    })
    const original = t.updatedAt.getTime()
    await new Promise((r) => setTimeout(r, 5))
    const updated = updateTemplate(db, t.id, { name: 'A renamed', sortOrder: 5 })
    expect(updated.name).toBe('A renamed')
    expect(updated.sortOrder).toBe(5)
    expect(updated.updatedAt.getTime()).toBeGreaterThan(original)
  })

  it('deleteTemplate removes the row and detaches workenvs.templateId (set null)', () => {
    const t = createTemplate(db, {
      name: 'T',
      runtime: 'orbstack',
      config: { runtime: 'orbstack' },
    })
    const w = createWorkenv(db, {
      name: 'using-template',
      slug: 'tmpl',
      worktreePath: '/t',
      runtime: 'orbstack',
      configHash: 'h',
      config: { runtime: 'orbstack', worktreePath: '/t' },
      templateId: t.id,
    })
    deleteTemplate(db, t.id)
    expect(getTemplateById(db, t.id)).toBeUndefined()
    expect(getWorkenvById(db, w.id)?.templateId).toBeNull()
  })

  it('deleteTemplate clears workspace default template references', () => {
    const workspace = db
      .insert(schema.workspaces)
      .values({ id: 'ws-1', name: 'Workspace', cwd: '/tmp/ws' })
      .returning()
      .get()
    const t = createTemplate(db, {
      name: 'T',
      runtime: 'orbstack',
      config: { runtime: 'orbstack' },
    })
    db.insert(schema.workspaceSettings)
      .values({
        id: 'settings-1',
        workspaceId: workspace.id,
        defaultWorkenvTemplateId: t.id,
      })
      .run()

    deleteTemplate(db, t.id)

    const settings = db
      .select()
      .from(schema.workspaceSettings)
      .where(eq(schema.workspaceSettings.id, 'settings-1'))
      .get()
    expect(settings?.defaultWorkenvTemplateId).toBeNull()
  })

  // ------------------- events -------------------

  it('appendWorkenvEvent persists a row tied to a workenv', () => {
    const w = createWorkenv(db, {
      name: 'evts',
      slug: 'e',
      worktreePath: '/e',
      runtime: 'orbstack',
      configHash: 'h',
      config: { runtime: 'orbstack', worktreePath: '/e' },
    })
    const e = appendWorkenvEvent(db, {
      workenvId: w.id,
      type: 'created',
      payload: { foo: 'bar' },
    })
    expect(e.id).toMatch(/.+/)
    expect(e.workenvId).toBe(w.id)
    expect(e.type).toBe('created')
    expect(e.payload).toEqual({ foo: 'bar' })
    expect(e.createdAt).toBeInstanceOf(Date)
  })

  it('listEventsForWorkenv returns events newest-first and supports limit', async () => {
    const w = createWorkenv(db, {
      name: 'evts',
      slug: 'e2',
      worktreePath: '/e2',
      runtime: 'orbstack',
      configHash: 'h',
      config: { runtime: 'orbstack', worktreePath: '/e2' },
    })
    const types = ['created', 'state.changed', 'state.changed', 'health.ok'] as const
    for (const t of types) {
      appendWorkenvEvent(db, { workenvId: w.id, type: t })
      // 1ms gap so timestamp_ms gives a deterministic order.
      await new Promise((r) => setTimeout(r, 2))
    }

    const all = listEventsForWorkenv(db, w.id)
    expect(all).toHaveLength(4)
    // Newest first.
    expect(all[0]!.type).toBe('health.ok')
    expect(all[3]!.type).toBe('created')

    const limited = listEventsForWorkenv(db, w.id, { limit: 2 })
    expect(limited).toHaveLength(2)
    expect(limited[0]!.type).toBe('health.ok')
  })

  it('listEventsForWorkenv only returns events for the requested workenv', () => {
    const a = createWorkenv(db, {
      name: 'a',
      slug: 'a',
      worktreePath: '/a',
      runtime: 'orbstack',
      configHash: 'h',
      config: { runtime: 'orbstack', worktreePath: '/a' },
    })
    const b = createWorkenv(db, {
      name: 'b',
      slug: 'b',
      worktreePath: '/b',
      runtime: 'orbstack',
      configHash: 'h',
      config: { runtime: 'orbstack', worktreePath: '/b' },
    })
    appendWorkenvEvent(db, { workenvId: a.id, type: 'created' })
    appendWorkenvEvent(db, { workenvId: b.id, type: 'created' })
    appendWorkenvEvent(db, { workenvId: a.id, type: 'state.changed' })

    expect(listEventsForWorkenv(db, a.id)).toHaveLength(2)
    expect(listEventsForWorkenv(db, b.id)).toHaveLength(1)
  })

  it('deleteWorkenv cascades to workenv_events', () => {
    const w = createWorkenv(db, {
      name: 'cascade',
      slug: 'c',
      worktreePath: '/c',
      runtime: 'orbstack',
      configHash: 'h',
      config: { runtime: 'orbstack', worktreePath: '/c' },
    })
    appendWorkenvEvent(db, { workenvId: w.id, type: 'created' })
    appendWorkenvEvent(db, { workenvId: w.id, type: 'state.changed' })
    expect(listEventsForWorkenv(db, w.id)).toHaveLength(2)
    deleteWorkenv(db, w.id)
    expect(listEventsForWorkenv(db, w.id)).toHaveLength(0)
  })
})
