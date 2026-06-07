import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { MigrationError } from '../errors.ts'
import { EventLog } from '../event-log.ts'
import { CURRENT_SCHEMA_VERSION_KEY, currentSchemaVersion, loadMigrations, runMigrations } from '../migrations.ts'

describe('event-log migrations', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    while (cleanups.length > 0) {
      try {
        cleanups.pop()!()
      } catch {
        /* best-effort */
      }
    }
  })

  function scratchDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'wanda-migrations-test-'))
    cleanups.push(() => rmSync(d, { recursive: true, force: true }))
    return d
  }

  function scratchDb(): Database.Database {
    const d = scratchDir()
    const path = join(d, 'events.db')
    const db = new Database(path)
    cleanups.push(() => {
      try {
        db.close()
      } catch {
        /* best-effort */
      }
    })
    return db
  }

  describe('loadMigrations', () => {
    it('returns files sorted by id', () => {
      const dir = scratchDir()
      writeFileSync(join(dir, '002-second.sql'), '-- noop')
      writeFileSync(join(dir, '001-first.sql'), '-- noop')
      writeFileSync(join(dir, '010-tenth.sql'), '-- noop')
      const mg = loadMigrations(dir)
      expect(mg.map((m) => m.id)).toEqual(['001', '002', '010'])
    })

    it('ignores files that do not match the pattern', () => {
      const dir = scratchDir()
      writeFileSync(join(dir, '001-initial.sql'), '-- noop')
      writeFileSync(join(dir, 'README.md'), '')
      writeFileSync(join(dir, '_scratch.sql'), '')
      const mg = loadMigrations(dir)
      expect(mg).toHaveLength(1)
      expect(mg[0]!.id).toBe('001')
    })

    it('rejects duplicate ids', () => {
      const dir = scratchDir()
      writeFileSync(join(dir, '001-a.sql'), '-- a')
      writeFileSync(join(dir, '001-b.sql'), '-- b')
      expect(() => loadMigrations(dir)).toThrow(/duplicate migration id/)
    })

    it('throws if the directory does not exist', () => {
      expect(() => loadMigrations('/definitely/does/not/exist')).toThrow(/not found/)
    })
  })

  describe('runMigrations', () => {
    function baseline(): string {
      const dir = scratchDir()
      writeFileSync(
        join(dir, '001-initial.sql'),
        `CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, epoch INTEGER NOT NULL, channel TEXT NOT NULL, resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL, payload_json TEXT NOT NULL);`,
      )
      return dir
    }

    it('applies all pending migrations on a fresh DB', () => {
      const dir = baseline()
      const db = scratchDb()
      const { applied } = runMigrations(db, dir)
      expect(applied).toEqual(['001'])
      expect(currentSchemaVersion(db)).toBe('001')
    })

    it('is a no-op if the DB is already at the target version', () => {
      const dir = baseline()
      const db = scratchDb()
      runMigrations(db, dir)
      const { applied } = runMigrations(db, dir)
      expect(applied).toEqual([])
      expect(currentSchemaVersion(db)).toBe('001')
    })

    it('applies only migrations beyond the stored version', () => {
      const dir = baseline()
      // Simulate a DB at version 001 by inserting manually.
      const db = scratchDb()
      runMigrations(db, dir)

      writeFileSync(join(dir, '002-add-index.sql'), `CREATE INDEX IF NOT EXISTS events_by_ts ON events(ts);`)

      const { applied } = runMigrations(db, dir)
      expect(applied).toEqual(['002'])
      expect(currentSchemaVersion(db)).toBe('002')
    })

    it('rolls back a failing migration and leaves version unchanged', () => {
      const dir = baseline()
      const db = scratchDb()
      runMigrations(db, dir)

      // Bad SQL: unknown column.
      writeFileSync(
        join(dir, '002-broken.sql'),
        `ALTER TABLE events ADD COLUMN _tmp INTEGER; -- fine
         DROP TABLE does_not_exist;                  -- fails`,
      )

      expect(() => runMigrations(db, dir)).toThrow(MigrationError)
      // The _tmp column may or may not have been added depending on SQLite's
      // txn semantics — but the version row MUST remain at 001.
      expect(currentSchemaVersion(db)).toBe('001')
    })

    it('runs the real shipped 001-initial.sql and creates events table', () => {
      const db = scratchDb()
      // Default dir = packages/event-log/migrations
      runMigrations(db)
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").all()
      expect(rows).toHaveLength(1)
      expect(currentSchemaVersion(db)).toBe('001')
    })
  })

  describe('currentSchemaVersion', () => {
    it('returns 000 for a fresh DB with no _meta row', () => {
      const db = scratchDb()
      expect(currentSchemaVersion(db)).toBe('000')
    })

    it('reads a version written directly into _meta', () => {
      const db = scratchDb()
      db.exec('CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      db.prepare('INSERT INTO _meta (key, value) VALUES (?, ?)').run(CURRENT_SCHEMA_VERSION_KEY, '007')
      expect(currentSchemaVersion(db)).toBe('007')
    })
  })

  describe('EventLog constructor wiring', () => {
    it('auto-runs migrations from the shipped directory', () => {
      const dir = mkdtempSync(join(tmpdir(), 'wanda-event-log-ctor-'))
      cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
      const db = new Database(join(dir, 'events.db'))
      cleanups.push(() => db.close())
      const log = new EventLog(db, { epoch: 1 })
      // If migrations didn't run, the publish INSERT would fail.
      const rec = log.publish('event:pod:created', 'pod', 'p1', {})
      expect(rec.seq).toBe(1)
    })

    it('honours a custom migrationsDir (for tests)', () => {
      const customDir = scratchDir()
      mkdirSync(customDir, { recursive: true })
      writeFileSync(
        join(customDir, '001-custom.sql'),
        `CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, epoch INTEGER NOT NULL, channel TEXT NOT NULL, resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL, payload_json TEXT NOT NULL);`,
      )
      const db = scratchDb()
      const log = new EventLog(db, { epoch: 1, migrationsDir: customDir })
      expect(log.publish('event:pod:created', 'pod', 'p1', {}).seq).toBe(1)
    })
  })
})
