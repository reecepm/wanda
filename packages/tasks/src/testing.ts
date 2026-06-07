/**
 * In-memory storage adapter for testing. Ships as part of the package
 * so consumers can also use it in their own test suites.
 */

import { VersionConflictError } from './errors.ts'
import type {
  ContextRequestStorage,
  EventStorage,
  LearningStorage,
  ProjectStorage,
  StorageAdapter,
  TaskStorage,
  WorkspaceStorage,
} from './interfaces.ts'
import type {
  ContextRequest,
  Learning,
  Project,
  ProjectFilter,
  Task,
  TaskEvent,
  TaskFilter,
  Workspace,
} from './types.ts'

// ---------------------------------------------------------------------------
// In-memory TaskStorage
// ---------------------------------------------------------------------------

class MemoryTaskStorage implements TaskStorage {
  private tasks = new Map<string, Task>()

  async insert(task: Task): Promise<void> {
    this.tasks.set(task.id, structuredClone(task))
  }

  async get(id: string): Promise<Task | null> {
    const t = this.tasks.get(id)
    return t ? structuredClone(t) : null
  }

  async getMany(ids: string[]): Promise<Task[]> {
    const result: Task[] = []
    for (const id of ids) {
      const t = this.tasks.get(id)
      if (t) result.push(structuredClone(t))
    }
    return result
  }

  async list(filter: TaskFilter): Promise<Task[]> {
    let tasks = [...this.tasks.values()]

    if (filter.projectId) tasks = tasks.filter((t) => t.projectId === filter.projectId)
    if (filter.parentId !== undefined) tasks = tasks.filter((t) => t.parentId === filter.parentId)
    if (filter.status) tasks = tasks.filter((t) => filter.status!.includes(t.status))
    if (filter.type) tasks = tasks.filter((t) => filter.type!.includes(t.type))
    if (filter.assignable) tasks = tasks.filter((t) => filter.assignable!.includes(t.assignable))
    if (filter.origin) tasks = tasks.filter((t) => filter.origin!.includes(t.origin))
    if (filter.claimedBy) tasks = tasks.filter((t) => t.claimedBy === filter.claimedBy)
    if (filter.ids) tasks = tasks.filter((t) => filter.ids!.includes(t.id))
    if (filter.archived === false) tasks = tasks.filter((t) => t.archivedAt == null)
    if (filter.archived === true) tasks = tasks.filter((t) => t.archivedAt != null)

    return tasks.map((t) => structuredClone(t))
  }

  async update(id: string, patch: Partial<Task>, expectedVersion: number): Promise<Task> {
    const existing = this.tasks.get(id)
    if (!existing) throw new Error(`Task ${id} not found in storage`)
    if (existing.version !== expectedVersion) {
      throw new VersionConflictError(id, expectedVersion, existing.version)
    }
    const updated = { ...existing, ...patch }
    this.tasks.set(id, updated)
    return structuredClone(updated)
  }

  async delete(id: string): Promise<void> {
    this.tasks.delete(id)
  }
}

// ---------------------------------------------------------------------------
// In-memory ProjectStorage
// ---------------------------------------------------------------------------

class MemoryProjectStorage implements ProjectStorage {
  private projects = new Map<string, Project>()

  async insert(project: Project): Promise<void> {
    this.projects.set(project.id, structuredClone(project))
  }

  async get(id: string): Promise<Project | null> {
    const p = this.projects.get(id)
    return p ? structuredClone(p) : null
  }

  async list(filter: ProjectFilter): Promise<Project[]> {
    let projects = [...this.projects.values()]
    if (filter.workspaceId) projects = projects.filter((p) => p.workspaceId === filter.workspaceId)
    if (filter.archived === false) projects = projects.filter((p) => p.archivedAt == null)
    if (filter.archived === true) projects = projects.filter((p) => p.archivedAt != null)
    return projects.map((p) => structuredClone(p))
  }

  async update(id: string, patch: Partial<Project>, expectedVersion: number): Promise<Project> {
    const existing = this.projects.get(id)
    if (!existing) throw new Error(`Project ${id} not found in storage`)
    if (existing.version !== expectedVersion) {
      throw new VersionConflictError(id, expectedVersion, existing.version)
    }
    const updated = { ...existing, ...patch }
    this.projects.set(id, updated)
    return structuredClone(updated)
  }

  async delete(id: string): Promise<void> {
    this.projects.delete(id)
  }
}

// ---------------------------------------------------------------------------
// In-memory WorkspaceStorage
// ---------------------------------------------------------------------------

class MemoryWorkspaceStorage implements WorkspaceStorage {
  private workspaces = new Map<string, Workspace>()

  async insert(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace.id, structuredClone(workspace))
  }

  async get(id: string): Promise<Workspace | null> {
    const w = this.workspaces.get(id)
    return w ? structuredClone(w) : null
  }

  async list(): Promise<Workspace[]> {
    return [...this.workspaces.values()].map((w) => structuredClone(w))
  }

  async update(id: string, patch: Partial<Workspace>, expectedVersion: number): Promise<Workspace> {
    const existing = this.workspaces.get(id)
    if (!existing) throw new Error(`Workspace ${id} not found in storage`)
    if (existing.version !== expectedVersion) {
      throw new VersionConflictError(id, expectedVersion, existing.version)
    }
    const updated = { ...existing, ...patch }
    this.workspaces.set(id, updated)
    return structuredClone(updated)
  }

  async delete(id: string): Promise<void> {
    this.workspaces.delete(id)
  }
}

// ---------------------------------------------------------------------------
// In-memory EventStorage
// ---------------------------------------------------------------------------

class MemoryEventStorage implements EventStorage {
  private events: TaskEvent[] = []

  async append(event: TaskEvent): Promise<void> {
    this.events.push(structuredClone(event))
  }

  async list(opts: { after?: number; limit?: number; types?: string[] }): Promise<TaskEvent[]> {
    let events = [...this.events]
    if (opts.after != null) events = events.filter((e) => e.position > opts.after!)
    if (opts.types) events = events.filter((e) => opts.types!.includes(e.type))
    if (opts.limit) events = events.slice(0, opts.limit)
    return events
  }

  async lastPosition(): Promise<number> {
    if (this.events.length === 0) return 0
    return this.events[this.events.length - 1]!.position
  }
}

// ---------------------------------------------------------------------------
// In-memory LearningStorage
// ---------------------------------------------------------------------------

class MemoryLearningStorage implements LearningStorage {
  private learnings: Learning[] = []

  async insert(learning: Learning): Promise<void> {
    this.learnings.push(structuredClone(learning))
  }

  async list(taskId: string): Promise<Learning[]> {
    return this.learnings.filter((l) => l.taskId === taskId).map((l) => structuredClone(l))
  }
}

// ---------------------------------------------------------------------------
// In-memory ContextRequestStorage
// ---------------------------------------------------------------------------

class MemoryContextRequestStorage implements ContextRequestStorage {
  private requests = new Map<string, ContextRequest>()

  async insert(request: ContextRequest): Promise<void> {
    this.requests.set(request.id, structuredClone(request))
  }

  async get(id: string): Promise<ContextRequest | null> {
    const r = this.requests.get(id)
    return r ? structuredClone(r) : null
  }

  async update(id: string, patch: Partial<ContextRequest>): Promise<ContextRequest> {
    const existing = this.requests.get(id)
    if (!existing) throw new Error(`ContextRequest ${id} not found in storage`)
    const updated = { ...existing, ...patch }
    this.requests.set(id, updated)
    return structuredClone(updated)
  }

  async listByTask(taskId: string): Promise<ContextRequest[]> {
    return [...this.requests.values()].filter((r) => r.taskId === taskId).map((r) => structuredClone(r))
  }

  async listPending(): Promise<ContextRequest[]> {
    return [...this.requests.values()].filter((r) => r.status === 'pending').map((r) => structuredClone(r))
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMemoryStorage(): StorageAdapter {
  return {
    tasks: new MemoryTaskStorage(),
    projects: new MemoryProjectStorage(),
    workspaces: new MemoryWorkspaceStorage(),
    events: new MemoryEventStorage(),
    learnings: new MemoryLearningStorage(),
    contextRequests: new MemoryContextRequestStorage(),
  }
}
