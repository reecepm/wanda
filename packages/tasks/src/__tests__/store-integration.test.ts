import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskStore } from '../store.ts'
import type { Project, Workspace } from '../types.ts'
import { setupStore } from './helpers.ts'

describe('store integration', () => {
  let store: TaskStore
  let workspace: Workspace
  let project: Project

  beforeEach(async () => {
    const ctx = await setupStore()
    store = ctx.store
    workspace = ctx.workspace
    project = ctx.project
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('workspaces', () => {
    it('creates and retrieves a workspace', async () => {
      const ws = await store.workspaces.create({
        name: 'New Workspace',
        description: 'A test workspace',
      })

      expect(ws.name).toBe('New Workspace')
      expect(ws.description).toBe('A test workspace')
      expect(ws.version).toBe(1)

      const retrieved = await store.workspaces.get(ws.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.name).toBe('New Workspace')
    })

    it('lists all workspaces', async () => {
      // One already exists from setup
      const all = await store.workspaces.list()
      expect(all.length).toBeGreaterThanOrEqual(1)
    })

    it('updates a workspace', async () => {
      const updated = await store.workspaces.update(workspace.id, { description: 'Updated desc' }, workspace.version)

      expect(updated.description).toBe('Updated desc')
      expect(updated.version).toBe(2)
    })

    it('archives a workspace', async () => {
      await store.workspaces.archive(workspace.id)

      const ws = await store.workspaces.get(workspace.id)
      expect(ws!.archivedAt).toBeTypeOf('number')
    })

    it('returns null for nonexistent workspace', async () => {
      const ws = await store.workspaces.get('nonexistent')
      expect(ws).toBeNull()
    })
  })

  describe('projects', () => {
    it('creates and retrieves a project', async () => {
      const p = await store.projects.create({
        name: 'Another Project',
        workspaceId: workspace.id,
        identifier: 'ANO',
        config: { defaultLeaseTtl: 60_000 },
      })

      expect(p.name).toBe('Another Project')
      expect(p.config.defaultLeaseTtl).toBe(60_000)
      expect(p.workspaceId).toBe(workspace.id)

      const retrieved = await store.projects.get(p.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.name).toBe('Another Project')
    })

    it('lists projects by workspace', async () => {
      const projects = await store.projects.list({
        workspaceId: workspace.id,
      })
      expect(projects.length).toBeGreaterThanOrEqual(1)
    })

    it('updates a project', async () => {
      const updated = await store.projects.update(project.id, { description: 'Updated project' }, project.version)

      expect(updated.description).toBe('Updated project')
    })

    it('archives a project', async () => {
      await store.projects.archive(project.id)

      const p = await store.projects.get(project.id)
      expect(p!.archivedAt).toBeTypeOf('number')
    })

    it('returns null for nonexistent project', async () => {
      const p = await store.projects.get('nonexistent')
      expect(p).toBeNull()
    })
  })

  describe('events', () => {
    it('records events for all operations', async () => {
      const task = await store.tasks.create({
        title: 'Evented Task',
        projectId: project.id,
        status: 'ready',
      })
      await store.tasks.claim(task.id, 'agent-1')
      await store.tasks.complete(task.id)

      const events = await store.events.list()
      const types = events.map((e) => e.type)

      expect(types).toContain('task.created')
      expect(types).toContain('task.claimed')
      expect(types).toContain('task.completed')
    })

    it('events have monotonic positions', async () => {
      await store.tasks.create({
        title: 'A',
        projectId: project.id,
      })
      await store.tasks.create({
        title: 'B',
        projectId: project.id,
      })

      const events = await store.events.list()
      for (let i = 1; i < events.length; i++) {
        expect(events[i]!.position).toBeGreaterThan(events[i - 1]!.position)
      }
    })

    it('events include instance name', async () => {
      await store.tasks.create({
        title: 'X',
        projectId: project.id,
      })

      const events = await store.events.list()
      expect(events[0]!.instanceId).toBe('test-instance')
    })

    it('filters events by type', async () => {
      await store.tasks.create({
        title: 'A',
        projectId: project.id,
        status: 'ready',
      })

      const created = await store.events.list({ types: ['task.created'] })
      expect(created.length).toBeGreaterThan(0)
      expect(created.every((e) => e.type === 'task.created')).toBe(true)
    })

    it('filters events after position', async () => {
      await store.tasks.create({ title: 'A', projectId: project.id })
      const events1 = await store.events.list()
      const lastPos = events1[events1.length - 1]!.position

      await store.tasks.create({ title: 'B', projectId: project.id })

      const events2 = await store.events.list({ after: lastPos })
      expect(events2.length).toBe(1)
      expect(events2[0]!.position).toBeGreaterThan(lastPos)
    })
  })

  describe('event subscriptions', () => {
    it('on/off works for specific event types', async () => {
      const received: string[] = []
      const handler = () => {
        received.push('got it')
      }

      store.on('task.created', handler)

      await store.tasks.create({ title: 'A', projectId: project.id })
      expect(received).toHaveLength(1)

      store.off('task.created', handler)

      await store.tasks.create({ title: 'B', projectId: project.id })
      expect(received).toHaveLength(1) // no new events
    })

    it('wildcard * receives all events', async () => {
      const received: string[] = []
      store.on('*', (e) => received.push(e.type))

      const task = await store.tasks.create({
        title: 'Wildcard',
        projectId: project.id,
        status: 'ready',
      })
      await store.tasks.claim(task.id, 'agent-1')

      expect(received).toContain('task.created')
      expect(received).toContain('task.claimed')
    })
  })

  describe('tick', () => {
    it('expires leases and reconciles dependencies in one call', async () => {
      // Set up a task with an expired lease
      const t1 = await store.tasks.create({
        title: 'Expired Lease',
        projectId: project.id,
        status: 'ready',
      })
      await store.tasks.claim(t1.id, 'agent-1', { leaseTtl: 1 })

      // Set up a pending task whose dep is about to complete
      const dep = await store.tasks.create({
        title: 'Dep',
        projectId: project.id,
        status: 'ready',
      })
      const t2 = await store.tasks.create({
        title: 'Waiting',
        projectId: project.id,
        status: 'ready',
        dependsOn: [dep.id],
      })
      await store.tasks.claim(dep.id, 'agent-2')
      await store.tasks.complete(dep.id)

      // Advance time past lease expiry
      const realNow = Date.now
      vi.spyOn(Date, 'now').mockReturnValue(realNow() + 100)

      // One tick handles both
      await store.tick()

      const updated1 = await store.tasks.get(t1.id)
      expect(updated1!.status).toBe('ready') // lease expired

      const updated2 = await store.tasks.get(t2.id)
      expect(updated2!.status).toBe('ready') // deps met
    })
  })

  describe('close', () => {
    it('can be called without error', async () => {
      await expect(store.close()).resolves.not.toThrow()
    })
  })

  describe('task tree', () => {
    it('builds a task tree', async () => {
      const root = await store.tasks.create({
        title: 'Root',
        projectId: project.id,
      })
      const child1 = await store.tasks.create({
        title: 'Child 1',
        projectId: project.id,
        parentId: root.id,
      })
      const child2 = await store.tasks.create({
        title: 'Child 2',
        projectId: project.id,
        parentId: root.id,
      })
      await store.tasks.create({
        title: 'Grandchild',
        projectId: project.id,
        parentId: child1.id,
      })

      const tree = await store.tasks.getTree(root.id)

      expect(tree.task.title).toBe('Root')
      expect(tree.children).toHaveLength(2)

      const c1 = tree.children.find((c) => c.task.title === 'Child 1')
      expect(c1).toBeDefined()
      expect(c1!.children).toHaveLength(1)
      expect(c1!.children[0]!.task.title).toBe('Grandchild')

      const c2 = tree.children.find((c) => c.task.title === 'Child 2')
      expect(c2).toBeDefined()
      expect(c2!.children).toHaveLength(0)
    })
  })

  describe('auto-claim subtasks', () => {
    it('claims all ready subtasks when parent is claimed with autoClaimSubtasks', async () => {
      const autoProject = await store.projects.create({
        name: 'Auto Claim',
        workspaceId: workspace.id,
        identifier: 'AUT',
        config: { autoClaimSubtasks: true },
      })

      const parent = await store.tasks.create({
        title: 'Parent',
        projectId: autoProject.id,
        status: 'ready',
      })
      const child1 = await store.tasks.create({
        title: 'Child 1',
        projectId: autoProject.id,
        parentId: parent.id,
        status: 'ready',
      })
      const child2 = await store.tasks.create({
        title: 'Child 2',
        projectId: autoProject.id,
        parentId: parent.id,
        status: 'ready',
      })
      // Draft child should NOT be auto-claimed
      await store.tasks.create({
        title: 'Draft Child',
        projectId: autoProject.id,
        parentId: parent.id,
        status: 'draft',
      })

      await store.tasks.claim(parent.id, 'agent-1')

      const c1 = await store.tasks.get(child1.id)
      const c2 = await store.tasks.get(child2.id)
      expect(c1!.status).toBe('in_progress')
      expect(c1!.claimedBy).toBe('agent-1')
      expect(c2!.status).toBe('in_progress')
      expect(c2!.claimedBy).toBe('agent-1')
    })
  })
})
