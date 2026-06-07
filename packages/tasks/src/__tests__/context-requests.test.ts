import { beforeEach, describe, expect, it } from 'vitest'
import type { TaskStore } from '../store.ts'
import type { Project, Workspace } from '../types.ts'
import { setupStore } from './helpers.ts'

describe('context requests', () => {
  let store: TaskStore
  let workspace: Workspace
  let project: Project

  beforeEach(async () => {
    const ctx = await setupStore()
    store = ctx.store
    workspace = ctx.workspace
    project = ctx.project
  })

  it('creates a context request', async () => {
    const task = await store.tasks.create({
      title: 'Needs Context',
      projectId: project.id,
      status: 'ready',
    })
    await store.tasks.claim(task.id, 'agent-1')

    const request = await store.context.request(task.id, 'agent-1', 'Which database should I use?')

    expect(request.taskId).toBe(task.id)
    expect(request.agentId).toBe('agent-1')
    expect(request.question).toBe('Which database should I use?')
    expect(request.status).toBe('pending')
    expect(request.response).toBeNull()
  })

  it('answers a context request', async () => {
    const task = await store.tasks.create({
      title: 'Needs Context',
      projectId: project.id,
      status: 'ready',
    })
    await store.tasks.claim(task.id, 'agent-1')

    const request = await store.context.request(task.id, 'agent-1', 'Which DB?')

    const answered = await store.context.answer(request.id, 'human-1', 'Use PostgreSQL')

    expect(answered.status).toBe('answered')
    expect(answered.response).toBe('Use PostgreSQL')
    expect(answered.respondedBy).toBe('human-1')
    expect(answered.respondedAt).toBeTypeOf('number')
  })

  it('lists pending context requests', async () => {
    const task = await store.tasks.create({
      title: 'Multi Questions',
      projectId: project.id,
      status: 'ready',
    })
    await store.tasks.claim(task.id, 'agent-1')

    await store.context.request(task.id, 'agent-1', 'Question 1?')
    await store.context.request(task.id, 'agent-1', 'Question 2?')

    const pending = await store.context.pending()
    expect(pending).toHaveLength(2)
  })

  it('lists context requests by task', async () => {
    const task1 = await store.tasks.create({
      title: 'Task 1',
      projectId: project.id,
      status: 'ready',
    })
    const task2 = await store.tasks.create({
      title: 'Task 2',
      projectId: project.id,
      status: 'ready',
    })
    await store.tasks.claim(task1.id, 'agent-1')
    await store.tasks.claim(task2.id, 'agent-2')

    await store.context.request(task1.id, 'agent-1', 'Q for task 1')
    await store.context.request(task2.id, 'agent-2', 'Q for task 2')

    const task1Requests = await store.context.listByTask(task1.id)
    expect(task1Requests).toHaveLength(1)
    expect(task1Requests[0]!.question).toBe('Q for task 1')
  })

  describe('auto-block', () => {
    it('auto-blocks task on context request when project config says so', async () => {
      const autoBlockProject = await store.projects.create({
        name: 'Auto Block Project',
        workspaceId: workspace.id,
        identifier: 'ABP',
        config: { autoBlockOnContextRequest: true },
      })

      const task = await store.tasks.create({
        title: 'Will Auto Block',
        projectId: autoBlockProject.id,
        status: 'ready',
      })
      await store.tasks.claim(task.id, 'agent-1')

      const request = await store.context.request(task.id, 'agent-1', 'Need help')

      expect(request.autoBlocked).toBe(true)

      const updated = await store.tasks.get(task.id)
      expect(updated!.status).toBe('blocked')
    })

    it('auto-unblocks when all context requests are answered', async () => {
      const autoBlockProject = await store.projects.create({
        name: 'Auto Block Project',
        workspaceId: workspace.id,
        identifier: 'ABP',
        config: { autoBlockOnContextRequest: true },
      })

      const task = await store.tasks.create({
        title: 'Will Auto Unblock',
        projectId: autoBlockProject.id,
        status: 'ready',
      })
      await store.tasks.claim(task.id, 'agent-1')

      const req1 = await store.context.request(task.id, 'agent-1', 'Q1?')
      // Task should be blocked after first request
      expect((await store.tasks.get(task.id))!.status).toBe('blocked')

      // Answer the request
      await store.context.answer(req1.id, 'human-1', 'A1')

      // Task should be unblocked (back to claimed)
      const updated = await store.tasks.get(task.id)
      expect(updated!.status).toBe('in_progress')
    })

    it('stays blocked when some context requests are still pending', async () => {
      const autoBlockProject = await store.projects.create({
        name: 'Auto Block Project',
        workspaceId: workspace.id,
        identifier: 'ABP',
        config: { autoBlockOnContextRequest: true },
      })

      const task = await store.tasks.create({
        title: 'Partial Answer',
        projectId: autoBlockProject.id,
        status: 'ready',
      })
      await store.tasks.claim(task.id, 'agent-1')

      const req1 = await store.context.request(task.id, 'agent-1', 'Q1?')
      // Task is blocked now, but second request also needs to go through
      // Note: the task is already blocked so the second request won't re-block
      await store.context.request(task.id, 'agent-1', 'Q2?')

      // Answer only the first
      await store.context.answer(req1.id, 'human-1', 'A1')

      // Still pending Q2, so stays blocked
      const updated = await store.tasks.get(task.id)
      expect(updated!.status).toBe('blocked')
    })

    it('does not auto-block when config is disabled', async () => {
      const task = await store.tasks.create({
        title: 'No Auto Block',
        projectId: project.id,
        status: 'ready',
      })
      await store.tasks.claim(task.id, 'agent-1')

      const request = await store.context.request(task.id, 'agent-1', 'Q?')

      expect(request.autoBlocked).toBe(false)

      const updated = await store.tasks.get(task.id)
      expect(updated!.status).toBe('in_progress') // unchanged
    })
  })

  it('emits context.requested and context.answered events', async () => {
    const requested: unknown[] = []
    const answered: unknown[] = []
    store.on('context.requested', (e) => requested.push(e))
    store.on('context.answered', (e) => answered.push(e))

    const task = await store.tasks.create({
      title: 'Events',
      projectId: project.id,
      status: 'ready',
    })
    await store.tasks.claim(task.id, 'agent-1')

    const req = await store.context.request(task.id, 'agent-1', 'Q?')
    expect(requested).toHaveLength(1)

    await store.context.answer(req.id, 'human-1', 'A')
    expect(answered).toHaveLength(1)
  })
})
