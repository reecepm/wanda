import { PeerNotFoundError, RemoteTaskError } from './errors.ts'
import type { PeerConnection } from './interfaces.ts'
import type { PeerConfig, PeerStatus, Task, TaskEvent, TaskFilter } from './types.ts'

interface PeerEntry {
  config: PeerConfig
  connection: PeerConnection
  tasks: Map<string, Task>
  abortController: AbortController
}

export class PeerManager {
  private peers = new Map<string, PeerEntry>()

  add(config: PeerConfig, connection: PeerConnection): void {
    // Clean up existing peer with same name if reconnecting
    const existing = this.peers.get(config.name)
    if (existing) {
      existing.abortController.abort()
      existing.connection.close().catch(() => {})
    }

    const ac = new AbortController()
    const entry: PeerEntry = {
      config,
      connection,
      tasks: new Map(),
      abortController: ac,
    }

    this.peers.set(config.name, entry)

    // Start consuming the event stream in the background
    this.consumeEvents(config.name, entry, ac.signal)

    // Handle disconnects
    connection.onDisconnect(() => {
      const current = this.peers.get(config.name)
      if (current === entry) {
        entry.tasks.clear()
      }
    })
  }

  remove(name: string): void {
    const entry = this.peers.get(name)
    if (!entry) return
    entry.abortController.abort()
    entry.connection.close().catch(() => {})
    this.peers.delete(name)
  }

  reconnect(name: string, connection: PeerConnection): void {
    const entry = this.peers.get(name)
    if (!entry) throw new PeerNotFoundError(name)
    this.add(entry.config, connection)
  }

  status(): PeerStatus[] {
    const result: PeerStatus[] = []
    for (const [name, entry] of this.peers) {
      result.push({
        name,
        connected: entry.tasks.size > 0 || !entry.abortController.signal.aborted,
        taskCount: entry.tasks.size,
      })
    }
    return result
  }

  /** Get all remote tasks from all peers, optionally filtered. */
  listRemoteTasks(filter?: TaskFilter): Task[] {
    const tasks: Task[] = []
    for (const [peerName, entry] of this.peers) {
      if (filter?.source && filter.source !== 'remote' && filter.source !== peerName) {
        continue
      }
      for (const task of entry.tasks.values()) {
        if (matchesFilter(task, filter)) {
          tasks.push(task)
        }
      }
    }
    return tasks
  }

  /** Get a single remote task by id, searching all peers. */
  getRemoteTask(id: string): { task: Task; peer: string } | null {
    for (const [name, entry] of this.peers) {
      const task = entry.tasks.get(id)
      if (task) return { task, peer: name }
    }
    return null
  }

  /** Proxy an RPC call to the peer that owns a given task. */
  async rpc<T>(peerName: string, method: string, params: Record<string, unknown>): Promise<T> {
    const entry = this.peers.get(peerName)
    if (!entry) throw new PeerNotFoundError(peerName)
    try {
      return await entry.connection.rpc<T>(method, params)
    } catch (err) {
      throw new RemoteTaskError(peerName, method, err)
    }
  }

  close(): void {
    for (const entry of this.peers.values()) {
      entry.abortController.abort()
      entry.connection.close().catch(() => {})
    }
    this.peers.clear()
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async consumeEvents(_name: string, entry: PeerEntry, signal: AbortSignal): Promise<void> {
    try {
      for await (const event of entry.connection.subscribe()) {
        if (signal.aborted) break
        this.applyEvent(entry, event)
      }
    } catch {
      // Stream ended or errored — the onDisconnect handler will fire
    }
  }

  private applyEvent(entry: PeerEntry, event: TaskEvent): void {
    const data = event.data as Record<string, unknown>

    switch (event.type) {
      case 'task.created': {
        const task = data['task'] as Task | undefined
        if (task) entry.tasks.set(task.id, task)
        break
      }
      case 'task.updated':
      case 'task.status_changed':
      case 'task.claimed':
      case 'task.released':
      case 'task.completed':
      case 'task.failed':
      case 'task.blocked':
      case 'task.unblocked': {
        // For update events, merge the patch into the cached task
        const existing = entry.tasks.get(event.entityId)
        if (existing) {
          const updates = (data['updates'] ?? data['task'] ?? data) as Partial<Task>
          entry.tasks.set(event.entityId, { ...existing, ...updates })
        }
        break
      }
      case 'task.deleted': {
        entry.tasks.delete(event.entityId)
        break
      }
      // Other event types (context, learning, project, workspace) — skip
    }
  }
}

function matchesFilter(task: Task, filter?: TaskFilter): boolean {
  if (!filter) return true
  if (filter.projectId && task.projectId !== filter.projectId) return false
  if (filter.parentId !== undefined && task.parentId !== filter.parentId) return false
  if (filter.status && !filter.status.includes(task.status)) return false
  if (filter.type && !filter.type.includes(task.type)) return false
  if (filter.assignable && !filter.assignable.includes(task.assignable)) return false
  if (filter.origin && !filter.origin.includes(task.origin)) return false
  if (filter.claimedBy && task.claimedBy !== filter.claimedBy) return false
  if (filter.ids && !filter.ids.includes(task.id)) return false
  if (filter.archived === false && task.archivedAt != null) return false
  if (filter.archived === true && task.archivedAt == null) return false
  return true
}
