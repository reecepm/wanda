import { WorkspaceNotFoundError } from './errors.ts'
import type { EventBus } from './event-bus.ts'
import { generateId } from './id.ts'
import type { StorageAdapter } from './interfaces.ts'
import type { NewWorkspace, Workspace, WorkspaceUpdate } from './types.ts'

export class WorkspaceManager {
  private storage: StorageAdapter
  private events: EventBus

  constructor(storage: StorageAdapter, events: EventBus) {
    this.storage = storage
    this.events = events
  }

  async create(input: NewWorkspace): Promise<Workspace> {
    const now = Date.now()
    const workspace: Workspace = {
      id: generateId(),
      name: input.name,
      description: input.description ?? null,
      config: input.config ?? {},
      labels: input.labels ?? {},
      metadata: input.metadata ?? {},
      version: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }

    await this.storage.workspaces.insert(workspace)
    await this.events.emit('workspace.created', workspace.id, { workspace })
    return workspace
  }

  async get(id: string): Promise<Workspace> {
    const ws = await this.storage.workspaces.get(id)
    if (!ws) throw new WorkspaceNotFoundError(id)
    return ws
  }

  async list(): Promise<Workspace[]> {
    return this.storage.workspaces.list()
  }

  async update(id: string, updates: WorkspaceUpdate, expectedVersion: number): Promise<Workspace> {
    await this.get(id)
    const updated = await this.storage.workspaces.update(
      id,
      { ...updates, version: expectedVersion + 1, updatedAt: Date.now() },
      expectedVersion,
    )
    await this.events.emit('workspace.updated', id, { updates })
    return updated
  }

  async archive(id: string): Promise<void> {
    const ws = await this.get(id)
    await this.storage.workspaces.update(
      id,
      { archivedAt: Date.now(), version: ws.version + 1, updatedAt: Date.now() },
      ws.version,
    )
    await this.events.emit('workspace.archived', id, {})
  }
}
