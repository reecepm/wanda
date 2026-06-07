import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../migrate'
import * as schema from '../schema'
import * as taskSchema from '../task-schema'

function makeMigratedDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema: { ...schema, ...taskSchema } })
  runMigrations(db, join(__dirname, '../migrations'))
  return { db, sqlite }
}

interface ColumnInfo {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

interface IndexInfo {
  seq: number
  name: string
  unique: number
  origin: string
  partial: number
}

interface ForeignKey {
  id: number
  seq: number
  table: string
  from: string
  to: string
  on_update: string
  on_delete: string
  match: string
}

function tableExists(sqlite: Database.Database, name: string) {
  const row = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name)
  return Boolean(row)
}

function columns(sqlite: Database.Database, table: string): ColumnInfo[] {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[]
}

function indexes(sqlite: Database.Database, table: string): IndexInfo[] {
  return sqlite.prepare(`PRAGMA index_list(${table})`).all() as IndexInfo[]
}

function indexCols(sqlite: Database.Database, indexName: string) {
  const rows = sqlite.prepare(`PRAGMA index_info(${indexName})`).all() as { seqno: number; cid: number; name: string }[]
  return rows.map((r) => r.name)
}

function foreignKeys(sqlite: Database.Database, table: string): ForeignKey[] {
  return sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as ForeignKey[]
}

describe('workenv schema migration', () => {
  it('migrations apply cleanly against an empty database', () => {
    expect(() => makeMigratedDb()).not.toThrow()
  })

  it('creates the workenvs table with all expected columns', () => {
    const { sqlite } = makeMigratedDb()
    expect(tableExists(sqlite, 'workenvs')).toBe(true)

    const cols = columns(sqlite, 'workenvs')
    const colNames = cols.map((c) => c.name).sort()
    expect(colNames).toEqual(
      [
        'id',
        'name',
        'slug',
        'worktree_path',
        'runtime',
        'adapter_handle',
        'state',
        'config_hash',
        'config',
        'runtime_state',
        'resolved_ports',
        'template_id',
        'last_error',
        'last_healthy_at',
        'last_started_at',
        'last_stopped_at',
        'created_at',
        'updated_at',
      ].sort(),
    )

    const id = cols.find((c) => c.name === 'id')
    expect(id?.pk).toBe(1)
    expect(cols.find((c) => c.name === 'name')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'slug')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'worktree_path')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'runtime')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'state')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'config_hash')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'config')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'created_at')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'updated_at')?.notnull).toBe(1)
  })

  it('creates the workenv_events table with cascade FK to workenvs', () => {
    const { sqlite } = makeMigratedDb()
    expect(tableExists(sqlite, 'workenv_events')).toBe(true)

    const cols = columns(sqlite, 'workenv_events')
      .map((c) => c.name)
      .sort()
    expect(cols).toEqual(['id', 'workenv_id', 'type', 'payload', 'created_at'].sort())

    const fks = foreignKeys(sqlite, 'workenv_events')
    const workenvFk = fks.find((f) => f.from === 'workenv_id')
    expect(workenvFk).toBeDefined()
    expect(workenvFk?.table).toBe('workenvs')
    expect(workenvFk?.to).toBe('id')
    expect(workenvFk?.on_delete).toBe('CASCADE')
  })

  it('creates the workenv_templates table', () => {
    const { sqlite } = makeMigratedDb()
    expect(tableExists(sqlite, 'workenv_templates')).toBe(true)

    const cols = columns(sqlite, 'workenv_templates')
      .map((c) => c.name)
      .sort()
    expect(cols).toEqual(
      ['id', 'name', 'description', 'runtime', 'config', 'built_in', 'sort_order', 'created_at', 'updated_at'].sort(),
    )
  })

  it('creates the workenv_prebuilds table for reusable template machines', () => {
    const { sqlite } = makeMigratedDb()
    expect(tableExists(sqlite, 'workenv_prebuilds')).toBe(true)

    const cols = columns(sqlite, 'workenv_prebuilds')
      .map((c) => c.name)
      .sort()
    expect(cols).toEqual(
      [
        'id',
        'runtime',
        'config_hash',
        'adapter_handle',
        'state',
        'config',
        'runtime_state',
        'last_error',
        'created_at',
        'updated_at',
      ].sort(),
    )
  })

  it('adds workenv_id FK column to pods with onDelete set null', () => {
    const { sqlite } = makeMigratedDb()
    const cols = columns(sqlite, 'pods')
    expect(cols.some((c) => c.name === 'workenv_id')).toBe(true)

    const fks = foreignKeys(sqlite, 'pods')
    const workenvFk = fks.find((f) => f.from === 'workenv_id')
    expect(workenvFk).toBeDefined()
    expect(workenvFk?.table).toBe('workenvs')
    expect(workenvFk?.on_delete).toBe('SET NULL')
  })

  it('indexes workenvs on runtime and state', () => {
    const { sqlite } = makeMigratedDb()
    const idx = indexes(sqlite, 'workenvs')
    const names = idx.map((i) => i.name)

    const runtimeIdx = names.find((n) => n.includes('runtime') && !n.includes('handle') && !n.includes('unique'))
    expect(runtimeIdx, `expected a non-unique index on runtime, got: ${names.join(', ')}`).toBeDefined()
    if (runtimeIdx) expect(indexCols(sqlite, runtimeIdx)).toEqual(['runtime'])

    const stateIdx = names.find((n) => n.includes('state'))
    expect(stateIdx, `expected an index on state, got: ${names.join(', ')}`).toBeDefined()
    if (stateIdx) expect(indexCols(sqlite, stateIdx)).toEqual(['state'])
  })

  it('places a unique index on (runtime, adapter_handle)', () => {
    const { sqlite } = makeMigratedDb()
    const idx = indexes(sqlite, 'workenvs')

    const uniqueHandle = idx.find((i) => {
      if (i.unique !== 1) return false
      const cols = indexCols(sqlite, i.name)
      return cols.length === 2 && cols.includes('runtime') && cols.includes('adapter_handle')
    })
    expect(
      uniqueHandle,
      `expected a unique index on (runtime, adapter_handle); indexes: ${JSON.stringify(idx)}`,
    ).toBeDefined()
  })

  it('cascades workenv_events deletes when the workenv is removed', () => {
    const { sqlite } = makeMigratedDb()
    const now = Date.now()
    sqlite
      .prepare(
        `INSERT INTO workenvs (id, name, slug, worktree_path, runtime, state, config_hash, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('w1', 'Demo', 'demo', '/tmp/demo', 'orbstack', 'stopped', 'h0', '{}', now, now)

    sqlite
      .prepare(`INSERT INTO workenv_events (id, workenv_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('e1', 'w1', 'created', '{}', now)

    expect((sqlite.prepare('SELECT count(*) AS c FROM workenv_events').get() as { c: number }).c).toBe(1)

    sqlite.prepare('DELETE FROM workenvs WHERE id = ?').run('w1')

    expect((sqlite.prepare('SELECT count(*) AS c FROM workenv_events').get() as { c: number }).c).toBe(0)
  })

  it('sets pods.workenv_id to NULL when the workenv is destroyed', () => {
    const { sqlite } = makeMigratedDb()
    const now = Date.now()

    sqlite
      .prepare(`INSERT INTO workspaces (id, name, cwd, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('ws1', 'Workspace', '/tmp', 0, now, now)

    sqlite
      .prepare(
        `INSERT INTO workenvs (id, name, slug, worktree_path, runtime, state, config_hash, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('w2', 'Demo', 'demo2', '/tmp/demo2', 'colima', 'running', 'h0', '{}', now, now)

    sqlite
      .prepare(
        `INSERT INTO pods (id, workspace_id, name, cwd, status, workenv_id, container_lifecycle, is_template, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('p1', 'ws1', 'pod1', '/tmp', 'stopped', 'w2', 'inherit', 0, 0, now, now)

    sqlite.prepare('DELETE FROM workenvs WHERE id = ?').run('w2')

    const pod = sqlite.prepare('SELECT workenv_id FROM pods WHERE id = ?').get('p1') as { workenv_id: string | null }
    expect(pod.workenv_id).toBeNull()
  })

  it('rejects duplicate (runtime, adapter_handle) tuples', () => {
    const { sqlite } = makeMigratedDb()
    const now = Date.now()
    const insert = sqlite.prepare(
      `INSERT INTO workenvs (id, name, slug, worktree_path, runtime, adapter_handle, state, config_hash, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run('w3', 'A', 'a', '/tmp/a', 'orbstack', 'handle-x', 'stopped', 'h', '{}', now, now)
    expect(() => insert.run('w4', 'B', 'b', '/tmp/b', 'orbstack', 'handle-x', 'stopped', 'h', '{}', now, now)).toThrow()
  })

  it('allows the same adapter_handle on different runtimes', () => {
    const { sqlite } = makeMigratedDb()
    const now = Date.now()
    const insert = sqlite.prepare(
      `INSERT INTO workenvs (id, name, slug, worktree_path, runtime, adapter_handle, state, config_hash, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run('w5', 'A', 'a2', '/tmp/a2', 'orbstack', 'shared', 'stopped', 'h', '{}', now, now)
    expect(() =>
      insert.run('w6', 'B', 'b2', '/tmp/b2', 'colima', 'shared', 'stopped', 'h', '{}', now, now),
    ).not.toThrow()
  })

  it('allows multiple workenvs with NULL adapter_handle (pre-create state)', () => {
    const { sqlite } = makeMigratedDb()
    const now = Date.now()
    const insert = sqlite.prepare(
      `INSERT INTO workenvs (id, name, slug, worktree_path, runtime, state, config_hash, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run('w7', 'A', 'a3', '/tmp/a3', 'orbstack', 'creating', 'h', '{}', now, now)
    expect(() => insert.run('w8', 'B', 'b3', '/tmp/b3', 'orbstack', 'creating', 'h', '{}', now, now)).not.toThrow()
  })
})
