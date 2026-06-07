import { beforeEach, describe, expect, it } from 'vitest'
import { TaskNotFoundError } from '../errors.ts'
import type { TaskStore } from '../store.ts'
import type { Project } from '../types.ts'
import { setupStore } from './helpers.ts'

describe('learnings', () => {
  let store: TaskStore
  let project: Project

  beforeEach(async () => {
    const ctx = await setupStore()
    store = ctx.store
    project = ctx.project
  })

  it('adds a learning to a task', async () => {
    const task = await store.tasks.create({
      title: 'Learning Task',
      projectId: project.id,
    })

    const learning = await store.learnings.add(task.id, 'Always validate input before processing')

    expect(learning.taskId).toBe(task.id)
    expect(learning.content).toBe('Always validate input before processing')
    expect(learning.sourceTaskId).toBeNull()
  })

  it('adds a learning with source task', async () => {
    const parent = await store.tasks.create({
      title: 'Parent',
      projectId: project.id,
    })
    const child = await store.tasks.create({
      title: 'Child',
      projectId: project.id,
      parentId: parent.id,
    })

    const learning = await store.learnings.add(parent.id, 'Discovery from child', child.id)

    expect(learning.sourceTaskId).toBe(child.id)
  })

  it('lists learnings for a task', async () => {
    const task = await store.tasks.create({
      title: 'Multi-learn',
      projectId: project.id,
    })

    await store.learnings.add(task.id, 'Learning 1')
    await store.learnings.add(task.id, 'Learning 2')
    await store.learnings.add(task.id, 'Learning 3')

    const learnings = await store.learnings.list(task.id)
    expect(learnings).toHaveLength(3)
  })

  it('throws TaskNotFoundError for nonexistent task', async () => {
    await expect(store.learnings.add('nonexistent', 'A learning')).rejects.toThrow(TaskNotFoundError)
  })

  it('bubbles learnings up to parent on task completion', async () => {
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

    // Add a learning to the child
    await store.learnings.add(child.id, 'Child learned something')

    // Complete the child
    await store.tasks.claim(child.id, 'agent-1')
    await store.tasks.complete(child.id)

    // Parent should now have the learning (bubbled up)
    const parentLearnings = await store.learnings.list(parent.id)
    expect(parentLearnings).toHaveLength(1)
    expect(parentLearnings[0]!.content).toBe('Child learned something')
    expect(parentLearnings[0]!.sourceTaskId).toBe(child.id)
  })

  it('emits learning.added event', async () => {
    const events: unknown[] = []
    store.on('learning.added', (e) => events.push(e))

    const task = await store.tasks.create({
      title: 'Events',
      projectId: project.id,
    })
    await store.learnings.add(task.id, 'A learning')

    expect(events).toHaveLength(1)
  })
})
