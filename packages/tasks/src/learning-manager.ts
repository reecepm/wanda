import { TaskNotFoundError } from './errors.ts'
import type { EventBus } from './event-bus.ts'
import { generateId } from './id.ts'
import type { StorageAdapter } from './interfaces.ts'
import type { Learning } from './types.ts'

export class LearningManager {
  private storage: StorageAdapter
  private events: EventBus

  constructor(storage: StorageAdapter, events: EventBus) {
    this.storage = storage
    this.events = events
  }

  async add(taskId: string, content: string, sourceTaskId?: string): Promise<Learning> {
    const task = await this.storage.tasks.get(taskId)
    if (!task) throw new TaskNotFoundError(taskId)

    const learning: Learning = {
      id: generateId(),
      taskId,
      sourceTaskId: sourceTaskId ?? null,
      content,
      createdAt: Date.now(),
    }

    await this.storage.learnings.insert(learning)

    await this.events.emit('learning.added', learning.id, { taskId, content, sourceTaskId: sourceTaskId ?? null })

    return learning
  }

  async list(taskId: string): Promise<Learning[]> {
    return this.storage.learnings.list(taskId)
  }
}
