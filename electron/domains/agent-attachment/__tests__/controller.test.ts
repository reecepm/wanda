// -----------------------------------------------------------------------------
// AgentAttachmentService controller tests — exercise the DB-backed upload
// dedup logic, atomic session binding (TOCTOU guard), and read-scoping.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AttachmentId, SessionId } from '@wanda/agent-protocol'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../../db/migrate'
import * as schema from '../../../db/schema'
import { chatSessions } from '../../../db/schema'
import * as taskSchema from '../../../db/task-schema'
import { DatabaseService } from '../../../infra/database'
import { AgentAttachmentService, AgentAttachmentServiceLive, configureAttachmentService } from '../controller'
import { blobPath } from '../storage'

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function seedSession(runtime: ManagedRuntime.ManagedRuntime<DatabaseService, never>, id: string) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const db = yield* DatabaseService
      const now = new Date()
      db.insert(chatSessions)
        .values({
          id,
          providerId: 'mock',
          workspaceId: null,
          podId: null,
          cwd: '/tmp',
          capabilities: { supportsToolInvocations: false } as never,
          modes: [],
          modelOptions: [],
          currentModeId: null,
          currentModelId: null,
          persistenceHandle: null,
          state: 'idle',
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }),
  )
}

describe('AgentAttachmentService', () => {
  let baseDir: string
  let runtime: ManagedRuntime.ManagedRuntime<AgentAttachmentService | DatabaseService, never>

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'wanda-attachments-'))
    configureAttachmentService({ baseDir })

    const dbLayer = Layer.sync(DatabaseService, () => {
      const sqlite = new Database(':memory:')
      sqlite.pragma('foreign_keys = ON')
      const db = drizzle(sqlite, { schema: { ...schema, ...taskSchema } })
      runMigrations(db, join(__dirname, '../../../db/migrations'))
      return db
    })
    const layer = AgentAttachmentServiceLive.pipe(Layer.provideMerge(dbLayer))
    runtime = ManagedRuntime.make(layer)
  })

  afterEach(async () => {
    await runtime.dispose()
    rmSync(baseDir, { recursive: true, force: true })
  })

  // --- upload ---------------------------------------------------------------

  it('upload writes blob and row, and dedups by sha within a session', async () => {
    const sessionId = 's_one' as unknown as SessionId
    await seedSession(runtime as never, sessionId as unknown as string)

    const svc = await runtime.runPromise(AgentAttachmentService)

    const first = await runtime.runPromise(
      svc.upload({ bytes: bytes('hello world'), mimeType: 'text/plain', sessionId }),
    )
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(first.byteSize).toBe(11)
    expect(readFileSync(blobPath(baseDir, first.sha256)).toString()).toBe('hello world')

    const second = await runtime.runPromise(
      svc.upload({ bytes: bytes('hello world'), mimeType: 'text/plain', sessionId }),
    )
    expect(second.id).toBe(first.id)
  })

  it('upload uses a null-session cohort for pre-bind uploads', async () => {
    const svc = await runtime.runPromise(AgentAttachmentService)
    const a = await runtime.runPromise(svc.upload({ bytes: bytes('same'), mimeType: 'text/plain' }))
    const b = await runtime.runPromise(svc.upload({ bytes: bytes('same'), mimeType: 'text/plain' }))
    expect(b.id).toBe(a.id)
    expect(a.sessionId).toBeNull()
  })

  it('upload in different sessions produces distinct rows even for identical bytes', async () => {
    const s1 = 's1' as unknown as SessionId
    const s2 = 's2' as unknown as SessionId
    await seedSession(runtime as never, s1 as unknown as string)
    await seedSession(runtime as never, s2 as unknown as string)
    const svc = await runtime.runPromise(AgentAttachmentService)
    const a = await runtime.runPromise(
      svc.upload({ bytes: bytes('payload'), mimeType: 'application/octet-stream', sessionId: s1 }),
    )
    const b = await runtime.runPromise(
      svc.upload({ bytes: bytes('payload'), mimeType: 'application/octet-stream', sessionId: s2 }),
    )
    expect(a.sha256).toBe(b.sha256)
    expect(a.id).not.toBe(b.id)
  })

  it('upload surfaces blob write failures as regular errors', async () => {
    const badBaseDir = join(baseDir, 'not-a-directory')
    writeFileSync(badBaseDir, 'file')
    configureAttachmentService({ baseDir: badBaseDir })
    const svc = await runtime.runPromise(AgentAttachmentService)

    await expect(runtime.runPromise(svc.upload({ bytes: bytes('payload'), mimeType: 'text/plain' }))).rejects.toThrow(
      /ENOTDIR|not a directory/,
    )
  })

  // --- ensureBoundToSession (TOCTOU) ---------------------------------------

  it('ensureBoundToSession binds an unbound row and succeeds', async () => {
    const sid = 'sbind' as unknown as SessionId
    await seedSession(runtime as never, sid as unknown as string)
    const svc = await runtime.runPromise(AgentAttachmentService)

    const row = await runtime.runPromise(svc.upload({ bytes: bytes('a'), mimeType: 'text/plain' }))
    expect(row.sessionId).toBeNull()

    const ok = await runtime.runPromise(svc.ensureBoundToSession(row.id, sid))
    expect(ok).toBe(true)

    const rebound = await runtime.runPromise(svc.findById(row.id))
    expect(rebound?.sessionId).toBe(sid)
  })

  it('ensureBoundToSession is a no-op for a row already bound to the caller', async () => {
    const sid = 'ssame' as unknown as SessionId
    await seedSession(runtime as never, sid as unknown as string)
    const svc = await runtime.runPromise(AgentAttachmentService)
    const row = await runtime.runPromise(svc.upload({ bytes: bytes('b'), mimeType: 'text/plain', sessionId: sid }))

    const okFirst = await runtime.runPromise(svc.ensureBoundToSession(row.id, sid, 't1'))
    expect(okFirst).toBe(true)
    const okSecond = await runtime.runPromise(svc.ensureBoundToSession(row.id, sid, 't2'))
    expect(okSecond).toBe(true)
    // firstReferencedTurnId must not flip from 't1' to 't2'.
    const readback = await runtime.runPromise(svc.findById(row.id))
    expect(readback?.firstReferencedTurnId).toBe('t1')
  })

  it('ensureBoundToSession fails for a row bound to a different session', async () => {
    const s1 = s('s1')
    const s2 = s('s2')
    await seedSession(runtime as never, s1 as unknown as string)
    await seedSession(runtime as never, s2 as unknown as string)
    const svc = await runtime.runPromise(AgentAttachmentService)
    const row = await runtime.runPromise(svc.upload({ bytes: bytes('c'), mimeType: 'text/plain', sessionId: s1 }))
    const ok = await runtime.runPromise(svc.ensureBoundToSession(row.id, s2))
    expect(ok).toBe(false)
    const readback = await runtime.runPromise(svc.findById(row.id))
    expect(readback?.sessionId).toBe(s1)
  })

  it('ensureBoundToSession returns false for a missing row', async () => {
    const sid = s('s_missing')
    await seedSession(runtime as never, sid as unknown as string)
    const svc = await runtime.runPromise(AgentAttachmentService)
    const ok = await runtime.runPromise(svc.ensureBoundToSession('att_does_not_exist' as unknown as AttachmentId, sid))
    expect(ok).toBe(false)
  })

  // --- findReadable scoping ------------------------------------------------

  it('findReadable returns the row when the session matches', async () => {
    const sid = s('sr')
    await seedSession(runtime as never, sid as unknown as string)
    const svc = await runtime.runPromise(AgentAttachmentService)
    const row = await runtime.runPromise(svc.upload({ bytes: bytes('x'), mimeType: 'text/plain', sessionId: sid }))
    const found = await runtime.runPromise(svc.findReadable(row.id, sid))
    expect(found?.id).toBe(row.id)
  })

  it('findReadable returns null when the session does not match', async () => {
    const s1 = s('s1a')
    const s2 = s('s2a')
    await seedSession(runtime as never, s1 as unknown as string)
    await seedSession(runtime as never, s2 as unknown as string)
    const svc = await runtime.runPromise(AgentAttachmentService)
    const row = await runtime.runPromise(svc.upload({ bytes: bytes('y'), mimeType: 'text/plain', sessionId: s1 }))
    const found = await runtime.runPromise(svc.findReadable(row.id, s2))
    expect(found).toBeNull()
  })

  it('findReadable allows the upload-window case (unbound row, null scope)', async () => {
    const svc = await runtime.runPromise(AgentAttachmentService)
    const row = await runtime.runPromise(svc.upload({ bytes: bytes('z'), mimeType: 'text/plain' }))
    const found = await runtime.runPromise(svc.findReadable(row.id, null))
    expect(found?.id).toBe(row.id)
  })
})

function s(value: string): SessionId {
  return value as unknown as SessionId
}
