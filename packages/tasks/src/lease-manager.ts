import { LeaseExpiredError, NotClaimedError, TaskNotFoundError } from './errors.ts'
import type { EventBus } from './event-bus.ts'
import type { StorageAdapter } from './interfaces.ts'
import type { Lease, Task } from './types.ts'

export class LeaseManager {
  private storage: StorageAdapter
  private events: EventBus

  constructor(storage: StorageAdapter, events: EventBus) {
    this.storage = storage
    this.events = events
  }

  getLease(task: Task): Lease | null {
    if (!task.claimedBy || task.claimedAt == null) return null
    return {
      taskId: task.id,
      agentId: task.claimedBy,
      claimedAt: task.claimedAt,
      expiresAt: task.leaseExpiresAt,
    }
  }

  async renew(taskId: string, ttl: number): Promise<Lease> {
    const task = await this.storage.tasks.get(taskId)
    if (!task) throw new TaskNotFoundError(taskId)
    if (task.status !== 'in_progress' || !task.claimedBy || task.claimedAt == null) {
      throw new NotClaimedError(taskId)
    }

    // Check if already expired
    if (task.leaseExpiresAt != null && task.leaseExpiresAt < Date.now()) {
      throw new LeaseExpiredError(taskId, task.leaseExpiresAt)
    }

    const now = Date.now()
    const expiresAt = now + ttl

    await this.storage.tasks.update(
      taskId,
      {
        leaseExpiresAt: expiresAt,
        version: task.version + 1,
        updatedAt: now,
      },
      task.version,
    )

    return {
      taskId,
      agentId: task.claimedBy,
      claimedAt: task.claimedAt,
      expiresAt,
    }
  }

  /**
   * Find and release all expired leases. Called by store.tick().
   * Returns the number of tasks that were released.
   */
  async expireStale(): Promise<number> {
    const claimed = await this.storage.tasks.list({ status: ['in_progress'] })
    const now = Date.now()
    let expired = 0

    for (const task of claimed) {
      if (task.leaseExpiresAt == null) continue
      if (task.leaseExpiresAt >= now) continue

      // Lease expired — release back to ready
      await this.storage.tasks.update(
        task.id,
        {
          status: 'ready',
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
          version: task.version + 1,
          updatedAt: now,
        },
        task.version,
      )

      await this.events.emit(
        'task.released',
        task.id,
        { reason: 'lease_expired', previousAgent: task.claimedBy },
        task.claimedBy,
      )

      expired++
    }

    return expired
  }
}
