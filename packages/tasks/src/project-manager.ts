import { ProjectNotFoundError, WorkspaceNotFoundError } from './errors.ts'
import type { EventBus } from './event-bus.ts'
import { generateId } from './id.ts'
import type { StorageAdapter } from './interfaces.ts'
import type { NewProject, Project, ProjectFilter, ProjectUpdate } from './types.ts'

export class ProjectManager {
  private storage: StorageAdapter
  private events: EventBus

  constructor(storage: StorageAdapter, events: EventBus) {
    this.storage = storage
    this.events = events
  }

  async create(input: NewProject): Promise<Project> {
    const ws = await this.storage.workspaces.get(input.workspaceId)
    if (!ws) throw new WorkspaceNotFoundError(input.workspaceId)

    const now = Date.now()
    const project: Project = {
      id: generateId(),
      workspaceId: input.workspaceId,
      name: input.name,
      identifier: input.identifier.toUpperCase(),
      description: input.description ?? null,
      sequenceCounter: 0,
      config: input.config ?? {},
      labels: input.labels ?? {},
      metadata: input.metadata ?? {},
      version: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }

    await this.storage.projects.insert(project)
    await this.events.emit('project.created', project.id, { project })
    return project
  }

  async get(id: string): Promise<Project> {
    const project = await this.storage.projects.get(id)
    if (!project) throw new ProjectNotFoundError(id)
    return project
  }

  async list(filter?: ProjectFilter): Promise<Project[]> {
    return this.storage.projects.list(filter ?? {})
  }

  async update(id: string, updates: ProjectUpdate, expectedVersion: number): Promise<Project> {
    await this.get(id)
    const updated = await this.storage.projects.update(
      id,
      { ...updates, version: expectedVersion + 1, updatedAt: Date.now() },
      expectedVersion,
    )
    await this.events.emit('project.updated', id, { updates })
    return updated
  }

  async archive(id: string): Promise<void> {
    const project = await this.get(id)
    await this.storage.projects.update(
      id,
      {
        archivedAt: Date.now(),
        version: project.version + 1,
        updatedAt: Date.now(),
      },
      project.version,
    )
    await this.events.emit('project.archived', id, {})
  }
}
