import { ContextRequestNotFoundError, TaskNotFoundError } from './errors.ts'
import type { EventBus } from './event-bus.ts'
import { generateId } from './id.ts'
import type { StorageAdapter } from './interfaces.ts'
import type { ContextRequest } from './types.ts'

export class ContextManager {
  private storage: StorageAdapter
  private events: EventBus

  constructor(storage: StorageAdapter, events: EventBus) {
    this.storage = storage
    this.events = events
  }

  async request(taskId: string, agentId: string, question: string): Promise<ContextRequest> {
    const task = await this.storage.tasks.get(taskId)
    if (!task) throw new TaskNotFoundError(taskId)

    // Check project config for auto-block
    const project = task.projectId ? await this.storage.projects.get(task.projectId) : null
    const autoBlock = project?.config.autoBlockOnContextRequest ?? false

    const now = Date.now()
    const request: ContextRequest = {
      id: generateId(),
      taskId,
      agentId,
      question,
      response: null,
      status: 'pending',
      autoBlocked: autoBlock,
      createdAt: now,
      respondedAt: null,
      respondedBy: null,
    }

    await this.storage.contextRequests.insert(request)

    // Auto-block the task if configured
    if (autoBlock && task.status === 'in_progress') {
      await this.storage.tasks.update(
        taskId,
        {
          status: 'blocked',
          version: task.version + 1,
          updatedAt: now,
        },
        task.version,
      )
      await this.events.emit('task.blocked', taskId, { reason: 'context_request', requestId: request.id }, agentId)
    }

    await this.events.emit('context.requested', request.id, { taskId, question }, agentId)

    return request
  }

  async answer(requestId: string, respondedBy: string, response: string): Promise<ContextRequest> {
    const request = await this.storage.contextRequests.get(requestId)
    if (!request) throw new ContextRequestNotFoundError(requestId)

    const now = Date.now()
    const updated = await this.storage.contextRequests.update(requestId, {
      response,
      status: 'answered',
      respondedAt: now,
      respondedBy,
    })

    await this.events.emit('context.answered', requestId, { taskId: request.taskId, response }, respondedBy)

    // If task was auto-blocked by this request, check if all requests
    // for this task are now answered — if so, unblock
    if (request.autoBlocked) {
      const taskRequests = await this.storage.contextRequests.listByTask(request.taskId)
      const hasPending = taskRequests.some((r) => r.status === 'pending')
      if (!hasPending) {
        const task = await this.storage.tasks.get(request.taskId)
        if (task && task.status === 'blocked') {
          await this.storage.tasks.update(
            task.id,
            {
              status: 'in_progress',
              version: task.version + 1,
              updatedAt: now,
            },
            task.version,
          )
          await this.events.emit('task.unblocked', task.id, { reason: 'context_requests_answered' }, respondedBy)
        }
      }
    }

    return updated
  }

  async listByTask(taskId: string): Promise<ContextRequest[]> {
    return this.storage.contextRequests.listByTask(taskId)
  }

  async pending(): Promise<ContextRequest[]> {
    return this.storage.contextRequests.listPending()
  }
}
