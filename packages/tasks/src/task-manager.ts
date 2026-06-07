import { AlreadyClaimedError, NotClaimedError, ProjectNotFoundError, TaskNotFoundError } from './errors.ts'
import type { EventBus } from './event-bus.ts'
import { generateId } from './id.ts'
import type { StorageAdapter } from './interfaces.ts'
import { assertTransition } from './state-machine.ts'
import type { Lease, NewTask, Task, TaskFilter, TaskResult, TaskTreeNode, TaskUpdate } from './types.ts'

export class TaskManager {
  private storage: StorageAdapter
  private events: EventBus

  constructor(storage: StorageAdapter, events: EventBus) {
    this.storage = storage
    this.events = events
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async create(input: NewTask): Promise<Task> {
    // Project is optional — tasks can exist standalone
    const project = input.projectId ? await this.storage.projects.get(input.projectId) : null
    if (input.projectId && !project) throw new ProjectNotFoundError(input.projectId)

    // If this is a subtask with a parent, inherit context
    let inherited: string | null = null
    if (input.parentId) {
      const parent = await this.storage.tasks.get(input.parentId)
      if (!parent) throw new TaskNotFoundError(input.parentId)
      inherited = buildInheritedContext(parent)
    }

    const hasDeps = input.dependsOn && input.dependsOn.length > 0
    let status: Task['status'] = input.status ?? 'draft'
    // If created as 'ready' but has unmet deps, go to 'pending' instead
    if (status === 'ready' && hasDeps) {
      status = 'pending'
    }

    // Assign sequence ID only when task belongs to a project
    let sequenceId: number | null = null
    if (project) {
      sequenceId = project.sequenceCounter + 1
      await this.storage.projects.update(
        project.id,
        { sequenceCounter: sequenceId, version: project.version + 1, updatedAt: Date.now() },
        project.version,
      )
    }

    const now = Date.now()
    const task: Task = {
      id: generateId(),
      projectId: input.projectId ?? null,
      sequenceId,
      parentId: input.parentId ?? null,
      title: input.title,
      description: input.description ?? null,
      content: input.content ?? null,
      type: input.type ?? 'task',
      status,
      origin: input.origin ?? 'human',
      assignable: input.assignable ?? 'either',
      priority: input.priority ?? 0,
      labels: input.labels ?? {},
      dependsOn: input.dependsOn ?? [],
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      context: { own: input.context ?? null, inherited },
      version: 1,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      archivedAt: null,
    }

    await this.storage.tasks.insert(task)
    await this.events.emit('task.created', task.id, { task }, task.createdBy)
    return task
  }

  async get(id: string): Promise<Task> {
    const task = await this.storage.tasks.get(id)
    if (!task) throw new TaskNotFoundError(id)
    return task
  }

  async getOrNull(id: string): Promise<Task | null> {
    return this.storage.tasks.get(id)
  }

  async list(filter?: TaskFilter): Promise<Task[]> {
    return this.storage.tasks.list(filter ?? {})
  }

  async update(id: string, updates: TaskUpdate, expectedVersion: number): Promise<Task> {
    const task = await this.get(id)

    // Recompute inherited context if context.own changed
    let context = task.context
    if (updates.context !== undefined) {
      context = { own: updates.context, inherited: task.context.inherited }
    }

    const now = Date.now()
    const patch: Partial<Task> = {
      ...updates,
      context,
      version: expectedVersion + 1,
      updatedAt: now,
    }

    // Handle status side effects
    if (updates.status !== undefined && updates.status !== task.status) {
      if (updates.status === 'completed') {
        patch.completedAt = now
      }
      if (updates.status !== 'in_progress' && task.status === 'in_progress') {
        patch.claimedBy = null
        patch.claimedAt = null
        patch.leaseExpiresAt = null
      }
    }

    const updated = await this.storage.tasks.update(id, patch, expectedVersion)
    await this.events.emit('task.updated', id, { updates }, task.claimedBy)

    // If context changed, propagate to children
    if (updates.context !== undefined) {
      await this.propagateContext(updated)
    }

    return updated
  }

  async delete(id: string): Promise<void> {
    const task = await this.get(id)
    if (task.status === 'in_progress') {
      throw new AlreadyClaimedError(id, task.claimedBy!)
    }
    await this.storage.tasks.delete(id)
    await this.events.emit('task.deleted', id, { task })
  }

  // ---------------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------------

  async publish(id: string): Promise<Task> {
    const task = await this.get(id)
    const hasDeps = task.dependsOn.length > 0
    const target = hasDeps ? 'pending' : 'ready'
    assertTransition(task.status, target as 'pending' | 'ready')

    return this.applyStatusChange(task, target as 'pending' | 'ready')
  }

  async claim(id: string, agentId: string, leaseTtl?: number): Promise<{ task: Task; lease: Lease }> {
    const task = await this.get(id)
    assertTransition(task.status, 'in_progress')

    if (task.claimedBy) {
      throw new AlreadyClaimedError(id, task.claimedBy)
    }

    // Resolve TTL: explicit > project config > no expiry
    let expiresAt: number | null = null
    if (leaseTtl != null) {
      expiresAt = Date.now() + leaseTtl
    } else if (task.projectId) {
      const project = await this.storage.projects.get(task.projectId)
      if (project?.config.defaultLeaseTtl) {
        expiresAt = Date.now() + project.config.defaultLeaseTtl
      }
    }

    const now = Date.now()
    const updated = await this.storage.tasks.update(
      id,
      {
        status: 'in_progress',
        claimedBy: agentId,
        claimedAt: now,
        leaseExpiresAt: expiresAt,
        version: task.version + 1,
        updatedAt: now,
      },
      task.version,
    )

    const lease: Lease = {
      taskId: id,
      agentId,
      claimedAt: now,
      expiresAt,
    }

    await this.events.emit('task.claimed', id, { agentId, lease }, agentId)

    // Auto-claim subtasks if project config says so
    const project = task.projectId ? await this.storage.projects.get(task.projectId) : null
    if (project?.config.autoClaimSubtasks) {
      const children = await this.storage.tasks.list({
        parentId: id,
        status: ['ready'],
      })
      for (const child of children) {
        await this.claim(child.id, agentId, leaseTtl).catch(() => {
          // Best-effort — skip if already claimed or invalid state
        })
      }
    }

    return { task: updated, lease }
  }

  async complete(id: string, result?: TaskResult): Promise<Task> {
    const task = await this.get(id)
    assertTransition(task.status, 'completed')

    const updated = await this.applyStatusChange(task, 'completed', {
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      completedAt: Date.now(),
    })

    await this.events.emit('task.completed', id, { result: result ?? {} }, task.claimedBy)

    // Bubble up learnings to parent
    if (task.parentId) {
      await this.bubbleLearnings(id, task.parentId)
    }

    return updated
  }

  async fail(id: string, reason: string): Promise<Task> {
    const task = await this.get(id)
    assertTransition(task.status, 'failed')

    const updated = await this.applyStatusChange(task, 'failed', {
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
    })

    await this.events.emit('task.failed', id, { reason }, task.claimedBy)

    return updated
  }

  async block(id: string, reason: string): Promise<Task> {
    const task = await this.get(id)
    assertTransition(task.status, 'blocked')

    const updated = await this.applyStatusChange(task, 'blocked')

    await this.events.emit('task.blocked', id, { reason }, task.claimedBy)

    return updated
  }

  async unblock(id: string): Promise<Task> {
    const task = await this.get(id)
    // Unblocking returns to 'ready' (agent must re-claim)
    assertTransition(task.status, 'ready')

    const updated = await this.applyStatusChange(task, 'ready', {
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
    })

    await this.events.emit('task.unblocked', id, {}, task.claimedBy)

    return updated
  }

  async release(id: string): Promise<Task> {
    const task = await this.get(id)
    if (task.status !== 'in_progress') throw new NotClaimedError(id)
    assertTransition(task.status, 'ready')

    const updated = await this.applyStatusChange(task, 'ready', {
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
    })

    await this.events.emit('task.released', id, {}, task.claimedBy)

    return updated
  }

  // ---------------------------------------------------------------------------
  // Tree
  // ---------------------------------------------------------------------------

  async getTree(id: string): Promise<TaskTreeNode> {
    const task = await this.get(id)
    return this.buildTreeNode(task)
  }

  async getDependencies(id: string): Promise<Task[]> {
    const task = await this.get(id)
    if (task.dependsOn.length === 0) return []
    return this.storage.tasks.getMany(task.dependsOn)
  }

  async getDependents(id: string): Promise<Task[]> {
    // Tasks whose dependsOn includes this id
    const all = await this.storage.tasks.list({})
    return all.filter((t) => t.dependsOn.includes(id))
  }

  // ---------------------------------------------------------------------------
  // Dependency reconciliation (called by tick)
  // ---------------------------------------------------------------------------

  async reconcileDependencies(): Promise<number> {
    const pending = await this.storage.tasks.list({ status: ['pending'] })
    let transitioned = 0

    for (const task of pending) {
      if (task.dependsOn.length === 0) {
        await this.applyStatusChange(task, 'ready')
        transitioned++
        continue
      }

      const deps = await this.storage.tasks.getMany(task.dependsOn)
      const allMet = deps.length === task.dependsOn.length && deps.every((d) => d.status === 'completed')

      if (allMet) {
        await this.applyStatusChange(task, 'ready')
        await this.events.emit('task.status_changed', task.id, {
          from: 'pending',
          to: 'ready',
          reason: 'dependencies_met',
        })
        transitioned++
      }
    }

    return transitioned
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async applyStatusChange(task: Task, to: Task['status'], extra?: Partial<Task>): Promise<Task> {
    const now = Date.now()
    return this.storage.tasks.update(
      task.id,
      {
        status: to,
        version: task.version + 1,
        updatedAt: now,
        ...extra,
      },
      task.version,
    )
  }

  private async buildTreeNode(task: Task): Promise<TaskTreeNode> {
    const children = await this.storage.tasks.list({ parentId: task.id })
    const childNodes = await Promise.all(children.map((c) => this.buildTreeNode(c)))
    return { task, children: childNodes }
  }

  private async propagateContext(task: Task): Promise<void> {
    const children = await this.storage.tasks.list({ parentId: task.id })
    for (const child of children) {
      const inherited = buildInheritedContext(task)
      await this.storage.tasks.update(
        child.id,
        {
          context: { own: child.context.own, inherited },
          version: child.version + 1,
          updatedAt: Date.now(),
        },
        child.version,
      )
      // Recurse
      const updated = await this.storage.tasks.get(child.id)
      if (updated) await this.propagateContext(updated)
    }
  }

  private async bubbleLearnings(fromTaskId: string, toTaskId: string): Promise<void> {
    const learnings = await this.storage.learnings.list(fromTaskId)
    for (const learning of learnings) {
      await this.storage.learnings.insert({
        id: generateId(),
        taskId: toTaskId,
        sourceTaskId: fromTaskId,
        content: learning.content,
        createdAt: Date.now(),
      })
    }
  }
}

function buildInheritedContext(parent: Task): string | null {
  const parts: string[] = []
  if (parent.context.inherited) parts.push(parent.context.inherited)
  if (parent.context.own) parts.push(parent.context.own)
  return parts.length > 0 ? parts.join('\n\n---\n\n') : null
}
