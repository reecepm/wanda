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
// Storage adapters — implemented by the consumer
// ---------------------------------------------------------------------------

export interface StorageAdapter {
  tasks: TaskStorage
  projects: ProjectStorage
  workspaces: WorkspaceStorage
  events: EventStorage
  learnings: LearningStorage
  contextRequests: ContextRequestStorage
}

export interface TaskStorage {
  insert(task: Task): Promise<void>
  get(id: string): Promise<Task | null>
  getMany(ids: string[]): Promise<Task[]>
  list(filter: TaskFilter): Promise<Task[]>
  /** Atomically update if version matches expectedVersion. Throw VersionConflictError on mismatch. */
  update(id: string, patch: Partial<Task>, expectedVersion: number): Promise<Task>
  delete(id: string): Promise<void>
}

export interface ProjectStorage {
  insert(project: Project): Promise<void>
  get(id: string): Promise<Project | null>
  list(filter: ProjectFilter): Promise<Project[]>
  update(id: string, patch: Partial<Project>, expectedVersion: number): Promise<Project>
  delete(id: string): Promise<void>
}

export interface WorkspaceStorage {
  insert(workspace: Workspace): Promise<void>
  get(id: string): Promise<Workspace | null>
  list(): Promise<Workspace[]>
  update(id: string, patch: Partial<Workspace>, expectedVersion: number): Promise<Workspace>
  delete(id: string): Promise<void>
}

export interface EventStorage {
  append(event: TaskEvent): Promise<void>
  list(opts: { after?: number; limit?: number; types?: string[] }): Promise<TaskEvent[]>
  lastPosition(): Promise<number>
}

export interface LearningStorage {
  insert(learning: Learning): Promise<void>
  list(taskId: string): Promise<Learning[]>
}

export interface ContextRequestStorage {
  insert(request: ContextRequest): Promise<void>
  get(id: string): Promise<ContextRequest | null>
  update(id: string, patch: Partial<ContextRequest>): Promise<ContextRequest>
  listByTask(taskId: string): Promise<ContextRequest[]>
  listPending(): Promise<ContextRequest[]>
}

// ---------------------------------------------------------------------------
// Peer connection — implemented by the consumer's transport layer
// ---------------------------------------------------------------------------

export interface PeerConnection {
  /** Subscribe to the remote instance's task event stream. */
  subscribe(): AsyncIterable<TaskEvent>

  /** Call a method on the remote instance (write-through). */
  rpc<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>

  /** Register a callback for when the connection drops. */
  onDisconnect(cb: () => void): void

  /** Tear down the connection. */
  close(): Promise<void>
}
