import { beforeEach, describe, expect, it } from 'vitest'
import type { TaskStore } from '../store.ts'
import type { Project } from '../types.ts'
import { setupStore } from './helpers.ts'

describe('nextReady', () => {
  let store: TaskStore
  let project: Project

  beforeEach(async () => {
    const ctx = await setupStore()
    store = ctx.store
    project = ctx.project
  })

  it('returns null when no tasks exist', async () => {
    const next = await store.tasks.nextReady()
    expect(next).toBeNull()
  })

  it('returns null when no tasks are ready', async () => {
    await store.tasks.create({
      title: 'Draft',
      projectId: project.id,
      status: 'draft',
    })

    const next = await store.tasks.nextReady()
    expect(next).toBeNull()
  })

  it('returns a ready task', async () => {
    await store.tasks.create({
      title: 'Ready Task',
      projectId: project.id,
      status: 'ready',
    })

    const next = await store.tasks.nextReady()
    expect(next).not.toBeNull()
    expect(next!.title).toBe('Ready Task')
  })

  it('prefers higher priority tasks', async () => {
    await store.tasks.create({
      title: 'Low Priority',
      projectId: project.id,
      status: 'ready',
      priority: 1,
    })
    await store.tasks.create({
      title: 'High Priority',
      projectId: project.id,
      status: 'ready',
      priority: 10,
    })

    const next = await store.tasks.nextReady()
    expect(next!.title).toBe('High Priority')
  })

  it('prefers deeper tasks over shallow ones (DFS)', async () => {
    const parent = await store.tasks.create({
      title: 'Parent',
      projectId: project.id,
      status: 'ready',
    })
    await store.tasks.create({
      title: 'Child',
      projectId: project.id,
      parentId: parent.id,
      status: 'ready',
    })

    const next = await store.tasks.nextReady()
    expect(next!.title).toBe('Child')
  })

  it('returns parent when all children are completed', async () => {
    const parent = await store.tasks.create({
      title: 'Parent',
      projectId: project.id,
      status: 'ready',
    })
    const child = await store.tasks.create({
      title: 'Child',
      projectId: project.id,
      parentId: parent.id,
      status: 'ready',
    })

    // Complete the child
    await store.tasks.claim(child.id, 'agent-1')
    await store.tasks.complete(child.id)

    const next = await store.tasks.nextReady()
    expect(next!.title).toBe('Parent')
  })

  it('skips tasks with unmet dependencies', async () => {
    const dep = await store.tasks.create({
      title: 'Dependency',
      projectId: project.id,
      status: 'ready',
    })

    await store.tasks.create({
      title: 'Blocked By Dep',
      projectId: project.id,
      status: 'ready',
      dependsOn: [dep.id],
    })
    // This task was downgraded to pending, so it won't show up
    // Create another ready task with no deps
    await store.tasks.create({
      title: 'Independent',
      projectId: project.id,
      status: 'ready',
    })

    const next = await store.tasks.nextReady()
    // Should get either "Dependency" or "Independent", not "Blocked By Dep"
    expect(next!.title).not.toBe('Blocked By Dep')
  })

  it('filters by assignable', async () => {
    await store.tasks.create({
      title: 'Human Only',
      projectId: project.id,
      status: 'ready',
      assignable: 'human',
    })
    await store.tasks.create({
      title: 'Agent Only',
      projectId: project.id,
      status: 'ready',
      assignable: 'agent',
    })

    const next = await store.tasks.nextReady({ assignable: 'agent' })
    expect(next!.title).toBe('Agent Only')
  })

  it('includes "either" assignable tasks when filtering', async () => {
    await store.tasks.create({
      title: 'Either',
      projectId: project.id,
      status: 'ready',
      assignable: 'either',
    })

    const next = await store.tasks.nextReady({ assignable: 'agent' })
    expect(next!.title).toBe('Either')
  })

  it('filters by projectId', async () => {
    const otherProject = await store.projects.create({
      name: 'Other',
      workspaceId: (await store.workspaces.list())[0]!.id,
      identifier: 'OTH',
    })

    await store.tasks.create({
      title: 'In Other Project',
      projectId: otherProject.id,
      status: 'ready',
    })
    await store.tasks.create({
      title: 'In Main Project',
      projectId: project.id,
      status: 'ready',
    })

    const next = await store.tasks.nextReady({ projectId: project.id })
    expect(next!.title).toBe('In Main Project')
  })

  it('finds the deepest unblocked leaf in a tree', async () => {
    const milestone = await store.tasks.create({
      title: 'Milestone',
      projectId: project.id,
      status: 'ready',
      type: 'milestone',
    })
    const epic = await store.tasks.create({
      title: 'Epic',
      projectId: project.id,
      parentId: milestone.id,
      status: 'ready',
      type: 'epic',
    })
    const task = await store.tasks.create({
      title: 'Task',
      projectId: project.id,
      parentId: epic.id,
      status: 'ready',
      type: 'task',
    })
    await store.tasks.create({
      title: 'Subtask',
      projectId: project.id,
      parentId: task.id,
      status: 'ready',
      type: 'subtask',
    })

    const next = await store.tasks.nextReady()
    expect(next!.title).toBe('Subtask')
  })
})
