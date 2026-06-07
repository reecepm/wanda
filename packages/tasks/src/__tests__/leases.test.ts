import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeaseExpiredError, NotClaimedError } from '../errors.ts'
import type { TaskStore } from '../store.ts'
import type { Project } from '../types.ts'
import { setupStore } from './helpers.ts'

describe('leases', () => {
  let store: TaskStore
  let project: Project

  beforeEach(async () => {
    const ctx = await setupStore()
    store = ctx.store
    project = ctx.project
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('renew', () => {
    it('extends the lease expiry', async () => {
      const task = await store.tasks.create({
        title: 'Renewable',
        projectId: project.id,
        status: 'ready',
      })
      await store.tasks.claim(task.id, 'agent-1', { leaseTtl: 60_000 })

      const renewed = await store.tasks.renew(task.id, { ttl: 120_000 })

      expect(renewed.expiresAt).toBeTypeOf('number')
      expect(renewed.agentId).toBe('agent-1')
    })

    it('rejects renew on non-claimed task', async () => {
      const task = await store.tasks.create({
        title: 'Not Claimed',
        projectId: project.id,
        status: 'ready',
      })

      await expect(store.tasks.renew(task.id, { ttl: 60_000 })).rejects.toThrow(NotClaimedError)
    })

    it('rejects renew on expired lease', async () => {
      const task = await store.tasks.create({
        title: 'Expired',
        projectId: project.id,
        status: 'ready',
      })

      // Claim with very short TTL
      await store.tasks.claim(task.id, 'agent-1', { leaseTtl: 1 })

      // Wait for expiry
      const realNow = Date.now
      vi.spyOn(Date, 'now').mockReturnValue(realNow() + 100)

      await expect(store.tasks.renew(task.id, { ttl: 60_000 })).rejects.toThrow(LeaseExpiredError)
    })
  })

  describe('tick — lease expiry', () => {
    it('releases tasks with expired leases', async () => {
      const task = await store.tasks.create({
        title: 'Will Expire',
        projectId: project.id,
        status: 'ready',
      })

      await store.tasks.claim(task.id, 'agent-1', { leaseTtl: 1 })

      // Advance time past expiry
      const realNow = Date.now
      vi.spyOn(Date, 'now').mockReturnValue(realNow() + 100)

      await store.tick()

      const updated = await store.tasks.get(task.id)
      expect(updated!.status).toBe('ready')
      expect(updated!.claimedBy).toBeNull()
    })

    it('does not release tasks with no expiry', async () => {
      const task = await store.tasks.create({
        title: 'No Expiry',
        projectId: project.id,
        status: 'ready',
      })

      await store.tasks.claim(task.id, 'agent-1') // no TTL

      // Advance time
      const realNow = Date.now
      vi.spyOn(Date, 'now').mockReturnValue(realNow() + 999_999)

      await store.tick()

      const updated = await store.tasks.get(task.id)
      expect(updated!.status).toBe('in_progress')
      expect(updated!.claimedBy).toBe('agent-1')
    })

    it('does not release tasks with future expiry', async () => {
      const task = await store.tasks.create({
        title: 'Not Yet',
        projectId: project.id,
        status: 'ready',
      })

      await store.tasks.claim(task.id, 'agent-1', {
        leaseTtl: 999_999,
      })

      await store.tick()

      const updated = await store.tasks.get(task.id)
      expect(updated!.status).toBe('in_progress')
    })

    it('emits task.released event with lease_expired reason', async () => {
      const events: unknown[] = []
      store.on('task.released', (e) => events.push(e))

      const task = await store.tasks.create({
        title: 'Expire Event',
        projectId: project.id,
        status: 'ready',
      })

      await store.tasks.claim(task.id, 'agent-1', { leaseTtl: 1 })

      const realNow = Date.now
      vi.spyOn(Date, 'now').mockReturnValue(realNow() + 100)

      await store.tick()

      expect(events).toHaveLength(1)
    })
  })
})
