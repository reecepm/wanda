import { beforeEach, describe, expect, it } from 'vitest'
import { PeerNotFoundError } from '../errors.ts'
import type { PeerConnection } from '../interfaces.ts'
import type { TaskStore } from '../store.ts'
import type { Project, Task, TaskEvent } from '../types.ts'
import { setupStore } from './helpers.ts'

/** Create a mock peer connection that yields events from the provided array. */
function createMockPeer(
  events: TaskEvent[],
  rpcHandler?: (method: string, params: Record<string, unknown>) => unknown,
): PeerConnection {
  let disconnectCb: (() => void) | null = null

  return {
    async *subscribe() {
      for (const event of events) {
        yield event
      }
    },
    async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
      if (rpcHandler) return rpcHandler(method, params) as T
      throw new Error(`No RPC handler for ${method}`)
    },
    onDisconnect(cb) {
      disconnectCb = cb
    },
    async close() {
      disconnectCb?.()
    },
  }
}

function makeTaskEvent(type: TaskEvent['type'], task: Partial<Task> & { id: string }): TaskEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    position: 1,
    type,
    entityId: task.id,
    agentId: null,
    data: { task },
    timestamp: Date.now(),
    instanceId: 'remote-instance',
  }
}

describe('peer manager', () => {
  let store: TaskStore
  let project: Project

  beforeEach(async () => {
    const ctx = await setupStore()
    store = ctx.store
    project = ctx.project
  })

  it('reports peer status', () => {
    const peers = store.peers.status()
    expect(peers).toEqual([])
  })

  it('adds a peer and reports its status', async () => {
    const conn = createMockPeer([])
    store.peers.add({ name: 'remote-1' }, conn)

    const status = store.peers.status()
    expect(status).toHaveLength(1)
    expect(status[0]!.name).toBe('remote-1')
  })

  it('removes a peer', async () => {
    const conn = createMockPeer([])
    store.peers.add({ name: 'remote-1' }, conn)
    store.peers.remove('remote-1')

    const status = store.peers.status()
    expect(status).toHaveLength(0)
  })

  it('caches tasks from peer event stream', async () => {
    const remoteTask: Task = {
      id: 'remote-task-1',
      projectId: 'remote-project',
      parentId: null,
      title: 'Remote Task',
      description: null,
      content: null,
      type: 'task',
      status: 'ready',
      origin: 'human',
      assignable: 'either',
      priority: 5,
      labels: {},
      dependsOn: [],
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      context: { own: null, inherited: null },
      version: 1,
      createdBy: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
      archivedAt: null,
    }

    const events: TaskEvent[] = [makeTaskEvent('task.created', remoteTask)]
    const conn = createMockPeer(events)
    store.peers.add({ name: 'remote-1' }, conn)

    // Give the async iterator time to process
    await new Promise((r) => setTimeout(r, 50))

    // Remote tasks should appear in aggregated list
    const all = await store.tasks.list()
    const remote = all.find((t) => t.id === 'remote-task-1')
    expect(remote).toBeDefined()
    expect(remote!.title).toBe('Remote Task')
  })

  it('clears remote tasks on peer disconnect', async () => {
    const remoteTask: Task = {
      id: 'will-disappear',
      projectId: 'p1',
      parentId: null,
      title: 'Ephemeral',
      description: null,
      content: null,
      type: 'task',
      status: 'ready',
      origin: 'human',
      assignable: 'either',
      priority: 0,
      labels: {},
      dependsOn: [],
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      context: { own: null, inherited: null },
      version: 1,
      createdBy: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
      archivedAt: null,
    }

    const conn = createMockPeer([makeTaskEvent('task.created', remoteTask)])
    store.peers.add({ name: 'remote-1' }, conn)

    // Wait for event processing
    await new Promise((r) => setTimeout(r, 50))

    let all = await store.tasks.list()
    expect(all.some((t) => t.id === 'will-disappear')).toBe(true)

    // Close the connection (triggers disconnect)
    await conn.close()

    all = await store.tasks.list()
    expect(all.some((t) => t.id === 'will-disappear')).toBe(false)
  })

  it('throws PeerNotFoundError for unknown peer reconnect', () => {
    expect(() => store.peers.reconnect('unknown', createMockPeer([]))).toThrow(PeerNotFoundError)
  })
})
