import { ContextManager } from './context-manager.ts'
import { EventBus } from './event-bus.ts'
import type { PeerConnection } from './interfaces.ts'
import { LearningManager } from './learning-manager.ts'
import { LeaseManager } from './lease-manager.ts'
import { findNextReady } from './next-ready.ts'
import { PeerManager } from './peer-manager.ts'
import { ProjectManager } from './project-manager.ts'
import { TaskManager } from './task-manager.ts'
import type {
  ClaimOptions,
  ContextRequest,
  Learning,
  Lease,
  NewProject,
  NewTask,
  NewWorkspace,
  NextReadyOptions,
  PeerConfig,
  PeerStatus,
  Project,
  ProjectFilter,
  ProjectUpdate,
  RenewOptions,
  Task,
  TaskEvent,
  TaskEventType,
  TaskFilter,
  TaskResult,
  TaskStoreOptions,
  TaskTreeNode,
  TaskUpdate,
  Workspace,
  WorkspaceUpdate,
} from './types.ts'
import { WorkspaceManager } from './workspace-manager.ts'

// ---------------------------------------------------------------------------
// Public store interface
// ---------------------------------------------------------------------------

export interface TaskStore {
  readonly instanceName: string

  tasks: {
    create(input: NewTask): Promise<Task>
    get(id: string): Promise<Task | null>
    list(filter?: TaskFilter): Promise<Task[]>
    update(id: string, updates: TaskUpdate, expectedVersion: number): Promise<Task>
    delete(id: string): Promise<void>
    publish(id: string): Promise<Task>
    claim(id: string, agentId: string, opts?: ClaimOptions): Promise<{ task: Task; lease: Lease }>
    complete(id: string, result?: TaskResult): Promise<Task>
    fail(id: string, reason: string): Promise<Task>
    block(id: string, reason: string): Promise<Task>
    unblock(id: string): Promise<Task>
    release(id: string): Promise<Task>
    renew(id: string, opts?: RenewOptions): Promise<Lease>
    nextReady(opts?: NextReadyOptions): Promise<Task | null>
    getTree(id: string): Promise<TaskTreeNode>
    getDependencies(id: string): Promise<Task[]>
    getDependents(id: string): Promise<Task[]>
    /** Resolve a task by raw ID or short identifier (e.g. "TSK-42"). */
    resolve(idOrShortId: string): Promise<Task | null>
  }

  projects: {
    create(input: NewProject): Promise<Project>
    get(id: string): Promise<Project | null>
    list(filter?: ProjectFilter): Promise<Project[]>
    update(id: string, updates: ProjectUpdate, expectedVersion: number): Promise<Project>
    archive(id: string): Promise<void>
  }

  workspaces: {
    create(input: NewWorkspace): Promise<Workspace>
    get(id: string): Promise<Workspace | null>
    list(): Promise<Workspace[]>
    update(id: string, updates: WorkspaceUpdate, expectedVersion: number): Promise<Workspace>
    archive(id: string): Promise<void>
  }

  learnings: {
    add(taskId: string, content: string, sourceTaskId?: string): Promise<Learning>
    list(taskId: string): Promise<Learning[]>
  }

  context: {
    request(taskId: string, agentId: string, question: string): Promise<ContextRequest>
    answer(requestId: string, respondedBy: string, response: string): Promise<ContextRequest>
    listByTask(taskId: string): Promise<ContextRequest[]>
    pending(): Promise<ContextRequest[]>
  }

  peers: {
    add(config: PeerConfig, connection: PeerConnection): void
    remove(name: string): void
    reconnect(name: string, connection: PeerConnection): void
    status(): PeerStatus[]
  }

  events: {
    list(opts?: { after?: number; limit?: number; types?: string[] }): Promise<TaskEvent[]>
  }

  on(type: TaskEventType | '*', handler: (event: TaskEvent) => void): void
  off(type: TaskEventType | '*', handler: (event: TaskEvent) => void): void

  /** Call on a regular interval to expire leases and reconcile dependencies. */
  tick(): Promise<void>

  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createTaskStore(opts: TaskStoreOptions): Promise<TaskStore> {
  const { storage, instanceName } = opts

  const eventBus = await EventBus.create(storage.events, instanceName)
  const taskManager = new TaskManager(storage, eventBus)
  const leaseManager = new LeaseManager(storage, eventBus)
  const contextManager = new ContextManager(storage, eventBus)
  const learningManager = new LearningManager(storage, eventBus)
  const workspaceManager = new WorkspaceManager(storage, eventBus)
  const projectManager = new ProjectManager(storage, eventBus)
  const peerManager = new PeerManager()

  // Aggregated list: local + remote tasks merged
  async function aggregatedList(filter?: TaskFilter): Promise<Task[]> {
    if (filter?.source === 'local') {
      return taskManager.list(filter)
    }
    if (filter?.source && filter.source !== 'remote') {
      // Specific peer name
      return peerManager.listRemoteTasks(filter)
    }

    const [local, remote] = await Promise.all([
      taskManager.list(filter),
      Promise.resolve(peerManager.listRemoteTasks(filter)),
    ])
    return [...local, ...remote]
  }

  async function aggregatedGet(id: string): Promise<Task | null> {
    const local = await taskManager.getOrNull(id)
    if (local) return local
    const remote = peerManager.getRemoteTask(id)
    return remote?.task ?? null
  }

  // For write operations on potentially-remote tasks, proxy to peer
  async function claimMaybeRemote(
    id: string,
    agentId: string,
    claimOpts?: ClaimOptions,
  ): Promise<{ task: Task; lease: Lease }> {
    const local = await taskManager.getOrNull(id)
    if (local) return taskManager.claim(id, agentId, claimOpts?.leaseTtl)

    const remote = peerManager.getRemoteTask(id)
    if (remote) {
      return peerManager.rpc(remote.peer, 'tasks.claim', {
        id,
        agentId,
        ...claimOpts,
      })
    }

    const { TaskNotFoundError } = await import('./errors.ts')
    throw new TaskNotFoundError(id)
  }

  async function completeMaybeRemote(id: string, result?: TaskResult): Promise<Task> {
    const local = await taskManager.getOrNull(id)
    if (local) return taskManager.complete(id, result)

    const remote = peerManager.getRemoteTask(id)
    if (remote) {
      return peerManager.rpc(remote.peer, 'tasks.complete', {
        id,
        result,
      })
    }

    const { TaskNotFoundError } = await import('./errors.ts')
    throw new TaskNotFoundError(id)
  }

  async function failMaybeRemote(id: string, reason: string): Promise<Task> {
    const local = await taskManager.getOrNull(id)
    if (local) return taskManager.fail(id, reason)

    const remote = peerManager.getRemoteTask(id)
    if (remote) {
      return peerManager.rpc(remote.peer, 'tasks.fail', { id, reason })
    }

    const { TaskNotFoundError } = await import('./errors.ts')
    throw new TaskNotFoundError(id)
  }

  async function releaseMaybeRemote(id: string): Promise<Task> {
    const local = await taskManager.getOrNull(id)
    if (local) return taskManager.release(id)

    const remote = peerManager.getRemoteTask(id)
    if (remote) {
      return peerManager.rpc(remote.peer, 'tasks.release', { id })
    }

    const { TaskNotFoundError } = await import('./errors.ts')
    throw new TaskNotFoundError(id)
  }

  async function renewMaybeRemote(id: string, renewOpts?: RenewOptions): Promise<Lease> {
    const local = await taskManager.getOrNull(id)
    if (local) {
      return leaseManager.renew(id, renewOpts?.ttl ?? 300_000)
    }

    const remote = peerManager.getRemoteTask(id)
    if (remote) {
      return peerManager.rpc(remote.peer, 'tasks.renew', {
        id,
        ...renewOpts,
      })
    }

    const { TaskNotFoundError } = await import('./errors.ts')
    throw new TaskNotFoundError(id)
  }

  async function nextReady(nrOpts?: NextReadyOptions): Promise<Task | null> {
    const allTasks = await aggregatedList({
      projectId: nrOpts?.projectId,
      archived: false,
    })
    return findNextReady(allTasks, nrOpts)
  }

  const store: TaskStore = {
    instanceName,

    tasks: {
      create: (input) => taskManager.create(input),
      get: (id) => aggregatedGet(id),
      list: (filter) => aggregatedList(filter),
      update: (id, updates, v) => taskManager.update(id, updates, v),
      delete: (id) => taskManager.delete(id),
      publish: (id) => taskManager.publish(id),
      claim: (id, agentId, o) => claimMaybeRemote(id, agentId, o),
      complete: (id, result) => completeMaybeRemote(id, result),
      fail: (id, reason) => failMaybeRemote(id, reason),
      block: (id, reason) => taskManager.block(id, reason),
      unblock: (id) => taskManager.unblock(id),
      release: (id) => releaseMaybeRemote(id),
      renew: (id, o) => renewMaybeRemote(id, o),
      nextReady: (o) => nextReady(o),
      getTree: (id) => taskManager.getTree(id),
      getDependencies: (id) => taskManager.getDependencies(id),
      getDependents: (id) => taskManager.getDependents(id),
      resolve: async (idOrShortId) => {
        // Try raw ID first
        const direct = await aggregatedGet(idOrShortId)
        if (direct) return direct

        // Try short identifier pattern: PREFIX-NUMBER
        const match = idOrShortId.match(/^([A-Za-z]+)-(\d+)$/)
        if (!match) return null

        const prefix = match[1]!.toUpperCase()
        const seqId = Number.parseInt(match[2]!, 10)

        // Find the project with this identifier
        const projects = await storage.projects.list({})
        const project = projects.find((p) => p.identifier === prefix)
        if (!project) return null

        // Find the task with this sequence ID in the project
        const tasks = await storage.tasks.list({ projectId: project.id })
        return tasks.find((t) => t.sequenceId === seqId) ?? null
      },
    },

    projects: {
      create: (input) => projectManager.create(input),
      get: (id) => projectManager.get(id).catch(() => null),
      list: (filter) => projectManager.list(filter),
      update: (id, updates, v) => projectManager.update(id, updates, v),
      archive: (id) => projectManager.archive(id),
    },

    workspaces: {
      create: (input) => workspaceManager.create(input),
      get: (id) => workspaceManager.get(id).catch(() => null),
      list: () => workspaceManager.list(),
      update: (id, updates, v) => workspaceManager.update(id, updates, v),
      archive: (id) => workspaceManager.archive(id),
    },

    learnings: {
      add: (taskId, content, sourceTaskId) => learningManager.add(taskId, content, sourceTaskId),
      list: (taskId) => learningManager.list(taskId),
    },

    context: {
      request: (taskId, agentId, question) => contextManager.request(taskId, agentId, question),
      answer: (requestId, respondedBy, response) => contextManager.answer(requestId, respondedBy, response),
      listByTask: (taskId) => contextManager.listByTask(taskId),
      pending: () => contextManager.pending(),
    },

    peers: {
      add: (config, connection) => peerManager.add(config, connection),
      remove: (name) => peerManager.remove(name),
      reconnect: (name, connection) => peerManager.reconnect(name, connection),
      status: () => peerManager.status(),
    },

    events: {
      list: (o) => storage.events.list(o ?? {}),
    },

    on: (type, handler) => eventBus.on(type, handler),
    off: (type, handler) => eventBus.off(type, handler),

    async tick() {
      await leaseManager.expireStale()
      await taskManager.reconcileDependencies()
    },

    async close() {
      peerManager.close()
    },
  }

  return store
}
