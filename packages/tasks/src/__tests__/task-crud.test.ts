import { beforeEach, describe, expect, it } from 'vitest'
import { ProjectNotFoundError, TaskNotFoundError } from '../errors.ts'
import type { TaskStore } from '../store.ts'
import type { Project } from '../types.ts'
import { setupStore } from './helpers.ts'

describe('task CRUD', () => {
  let store: TaskStore
  let project: Project

  beforeEach(async () => {
    const ctx = await setupStore()
    store = ctx.store
    project = ctx.project
  })

  describe('create', () => {
    it('creates a task with defaults', async () => {
      const task = await store.tasks.create({
        title: 'My Task',
        projectId: project.id,
      })

      expect(task.title).toBe('My Task')
      expect(task.projectId).toBe(project.id)
      expect(task.status).toBe('draft')
      expect(task.type).toBe('task')
      expect(task.origin).toBe('human')
      expect(task.assignable).toBe('either')
      expect(task.priority).toBe(0)
      expect(task.sequenceId).toBe(1)
      expect(task.version).toBe(1)
      expect(task.parentId).toBeNull()
      expect(task.claimedBy).toBeNull()
      expect(task.completedAt).toBeNull()
      expect(task.archivedAt).toBeNull()
      expect(task.labels).toEqual({})
      expect(task.dependsOn).toEqual([])
    })

    it('creates a task with all fields', async () => {
      const task = await store.tasks.create({
        title: 'Detailed Task',
        projectId: project.id,
        description: 'A description',
        content: 'Full content here',
        type: 'epic',
        status: 'ready',
        origin: 'agent',
        assignable: 'agent',
        priority: 10,
        labels: { team: 'backend' },
        context: 'This is the task context',
        createdBy: 'agent-1',
      })

      expect(task.description).toBe('A description')
      expect(task.content).toBe('Full content here')
      expect(task.type).toBe('epic')
      expect(task.status).toBe('ready')
      expect(task.origin).toBe('agent')
      expect(task.assignable).toBe('agent')
      expect(task.priority).toBe(10)
      expect(task.labels).toEqual({ team: 'backend' })
      expect(task.context.own).toBe('This is the task context')
      expect(task.createdBy).toBe('agent-1')
    })

    it('creates a task with status=ready when no dependencies', async () => {
      const task = await store.tasks.create({
        title: 'Ready Task',
        projectId: project.id,
        status: 'ready',
      })
      expect(task.status).toBe('ready')
    })

    it('downgrades status to pending when created as ready with dependencies', async () => {
      const dep = await store.tasks.create({
        title: 'Dependency',
        projectId: project.id,
      })

      const task = await store.tasks.create({
        title: 'Dependent Task',
        projectId: project.id,
        status: 'ready',
        dependsOn: [dep.id],
      })

      expect(task.status).toBe('pending')
      expect(task.dependsOn).toEqual([dep.id])
    })

    it('throws ProjectNotFoundError for invalid projectId', async () => {
      await expect(
        store.tasks.create({
          title: 'Orphan',
          projectId: 'nonexistent',
        }),
      ).rejects.toThrow(ProjectNotFoundError)
    })

    it('throws TaskNotFoundError for invalid parentId', async () => {
      await expect(
        store.tasks.create({
          title: 'Child',
          projectId: project.id,
          parentId: 'nonexistent',
        }),
      ).rejects.toThrow(TaskNotFoundError)
    })

    it('emits task.created event', async () => {
      const events: unknown[] = []
      store.on('task.created', (e) => events.push(e))

      await store.tasks.create({ title: 'Evented', projectId: project.id })

      expect(events).toHaveLength(1)
    })

    it('assigns sequential IDs within a project', async () => {
      const t1 = await store.tasks.create({ title: 'First', projectId: project.id })
      const t2 = await store.tasks.create({ title: 'Second', projectId: project.id })
      const t3 = await store.tasks.create({ title: 'Third', projectId: project.id })

      // sequenceIds from earlier tests may have consumed some, but these three should be consecutive
      expect(t2.sequenceId).toBe(t1.sequenceId + 1)
      expect(t3.sequenceId).toBe(t2.sequenceId + 1)
    })

    it('produces short identifier like TST-1', async () => {
      const task = await store.tasks.create({ title: 'Identifiable', projectId: project.id })
      // project.identifier is 'TST' (from helpers)
      expect(`${project.identifier}-${task.sequenceId}`).toMatch(/^TST-\d+$/)
    })

    it('sequences are independent per project', async () => {
      const ws = (await store.workspaces.list())[0]!
      const otherProject = await store.projects.create({
        name: 'Other',
        workspaceId: ws.id,
        identifier: 'OTH',
      })

      const t1 = await store.tasks.create({ title: 'In Other', projectId: otherProject.id })
      expect(t1.sequenceId).toBe(1)
    })

    it('creates a standalone task without a project', async () => {
      const task = await store.tasks.create({ title: 'No Project' })

      expect(task.title).toBe('No Project')
      expect(task.projectId).toBeNull()
      expect(task.sequenceId).toBeNull()
    })
  })

  describe('get', () => {
    it('returns a task by id', async () => {
      const created = await store.tasks.create({
        title: 'Find Me',
        projectId: project.id,
      })

      const found = await store.tasks.get(created.id)
      expect(found).not.toBeNull()
      expect(found!.title).toBe('Find Me')
    })

    it('returns null for nonexistent id', async () => {
      const found = await store.tasks.get('nonexistent')
      expect(found).toBeNull()
    })
  })

  describe('list', () => {
    it('lists all tasks', async () => {
      await store.tasks.create({ title: 'A', projectId: project.id })
      await store.tasks.create({ title: 'B', projectId: project.id })
      await store.tasks.create({ title: 'C', projectId: project.id })

      const tasks = await store.tasks.list()
      expect(tasks).toHaveLength(3)
    })

    it('filters by status', async () => {
      await store.tasks.create({
        title: 'Draft',
        projectId: project.id,
        status: 'draft',
      })
      await store.tasks.create({
        title: 'Ready',
        projectId: project.id,
        status: 'ready',
      })

      const ready = await store.tasks.list({ status: ['ready'] })
      expect(ready).toHaveLength(1)
      expect(ready[0]!.title).toBe('Ready')
    })

    it('filters by assignable', async () => {
      await store.tasks.create({
        title: 'Human Only',
        projectId: project.id,
        assignable: 'human',
      })
      await store.tasks.create({
        title: 'Agent Only',
        projectId: project.id,
        assignable: 'agent',
      })
      await store.tasks.create({
        title: 'Either',
        projectId: project.id,
        assignable: 'either',
      })

      const agentTasks = await store.tasks.list({ assignable: ['agent'] })
      expect(agentTasks).toHaveLength(1)
      expect(agentTasks[0]!.title).toBe('Agent Only')
    })

    it('filters by origin', async () => {
      await store.tasks.create({
        title: 'By Human',
        projectId: project.id,
        origin: 'human',
      })
      await store.tasks.create({
        title: 'By Agent',
        projectId: project.id,
        origin: 'agent',
      })

      const agentOrigin = await store.tasks.list({ origin: ['agent'] })
      expect(agentOrigin).toHaveLength(1)
      expect(agentOrigin[0]!.title).toBe('By Agent')
    })
  })

  describe('update', () => {
    it('updates title and description', async () => {
      const task = await store.tasks.create({
        title: 'Original',
        projectId: project.id,
      })

      const updated = await store.tasks.update(task.id, { title: 'Updated', description: 'New desc' }, task.version)

      expect(updated.title).toBe('Updated')
      expect(updated.description).toBe('New desc')
      expect(updated.version).toBe(2)
    })

    it('increments version on each update', async () => {
      const task = await store.tasks.create({
        title: 'V1',
        projectId: project.id,
      })

      const v2 = await store.tasks.update(task.id, { title: 'V2' }, 1)
      expect(v2.version).toBe(2)

      const v3 = await store.tasks.update(task.id, { title: 'V3' }, 2)
      expect(v3.version).toBe(3)
    })

    it('throws VersionConflictError on stale version', async () => {
      const task = await store.tasks.create({
        title: 'Conflict',
        projectId: project.id,
      })

      await store.tasks.update(task.id, { title: 'V2' }, 1)

      // Stale version
      const { VersionConflictError } = await import('../errors.ts')
      await expect(store.tasks.update(task.id, { title: 'V2-stale' }, 1)).rejects.toThrow(VersionConflictError)
    })

    it('emits task.updated event', async () => {
      const events: unknown[] = []
      store.on('task.updated', (e) => events.push(e))

      const task = await store.tasks.create({
        title: 'Evented',
        projectId: project.id,
      })
      await store.tasks.update(task.id, { title: 'Changed' }, task.version)

      expect(events).toHaveLength(1)
    })
  })

  describe('delete', () => {
    it('deletes a task', async () => {
      const task = await store.tasks.create({
        title: 'Delete Me',
        projectId: project.id,
      })

      await store.tasks.delete(task.id)

      const found = await store.tasks.get(task.id)
      expect(found).toBeNull()
    })

    it('throws if task is claimed', async () => {
      const task = await store.tasks.create({
        title: 'Claimed',
        projectId: project.id,
        status: 'ready',
      })

      await store.tasks.claim(task.id, 'agent-1')

      const { AlreadyClaimedError } = await import('../errors.ts')
      await expect(store.tasks.delete(task.id)).rejects.toThrow(AlreadyClaimedError)
    })

    it('emits task.deleted event', async () => {
      const events: unknown[] = []
      store.on('task.deleted', (e) => events.push(e))

      const task = await store.tasks.create({
        title: 'Will Delete',
        projectId: project.id,
      })
      await store.tasks.delete(task.id)

      expect(events).toHaveLength(1)
    })
  })
})
