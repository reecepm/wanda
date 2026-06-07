import { beforeEach, describe, expect, it } from 'vitest'
import type { TaskStore } from '../store.ts'
import type { Project } from '../types.ts'
import { setupStore } from './helpers.ts'

describe('progressive context inheritance', () => {
  let store: TaskStore
  let project: Project

  beforeEach(async () => {
    const ctx = await setupStore()
    store = ctx.store
    project = ctx.project
  })

  it('child inherits parent context on creation', async () => {
    const parent = await store.tasks.create({
      title: 'Parent',
      projectId: project.id,
      context: 'Parent context: rework the auth system',
    })

    const child = await store.tasks.create({
      title: 'Child',
      projectId: project.id,
      parentId: parent.id,
      context: 'Child context: update the login endpoint',
    })

    expect(child.context.own).toBe('Child context: update the login endpoint')
    expect(child.context.inherited).toBe('Parent context: rework the auth system')
  })

  it('grandchild inherits full ancestor chain', async () => {
    const milestone = await store.tasks.create({
      title: 'Milestone',
      projectId: project.id,
      context: 'Milestone: complete security audit',
    })

    const task = await store.tasks.create({
      title: 'Task',
      projectId: project.id,
      parentId: milestone.id,
      context: 'Task: review authentication',
    })

    const subtask = await store.tasks.create({
      title: 'Subtask',
      projectId: project.id,
      parentId: task.id,
      context: 'Subtask: check OAuth flow',
    })

    expect(subtask.context.own).toBe('Subtask: check OAuth flow')
    // Inherited should contain both milestone and task context
    expect(subtask.context.inherited).toContain('Milestone: complete security audit')
    expect(subtask.context.inherited).toContain('Task: review authentication')
  })

  it('child with no parent has null inherited context', async () => {
    const task = await store.tasks.create({
      title: 'Root Task',
      projectId: project.id,
      context: 'Some context',
    })

    expect(task.context.own).toBe('Some context')
    expect(task.context.inherited).toBeNull()
  })

  it('child with no own context still gets inherited', async () => {
    const parent = await store.tasks.create({
      title: 'Parent',
      projectId: project.id,
      context: 'Parent context',
    })

    const child = await store.tasks.create({
      title: 'Child',
      projectId: project.id,
      parentId: parent.id,
    })

    expect(child.context.own).toBeNull()
    expect(child.context.inherited).toBe('Parent context')
  })

  it('propagates context changes to children', async () => {
    const parent = await store.tasks.create({
      title: 'Parent',
      projectId: project.id,
      context: 'Original context',
    })

    const child = await store.tasks.create({
      title: 'Child',
      projectId: project.id,
      parentId: parent.id,
    })

    expect(child.context.inherited).toBe('Original context')

    // Update parent context
    await store.tasks.update(parent.id, { context: 'Updated context' }, parent.version)

    // Child should have updated inherited context
    const updatedChild = await store.tasks.get(child.id)
    expect(updatedChild!.context.inherited).toBe('Updated context')
  })

  it('propagates context changes recursively to grandchildren', async () => {
    const root = await store.tasks.create({
      title: 'Root',
      projectId: project.id,
      context: 'Root context',
    })

    const middle = await store.tasks.create({
      title: 'Middle',
      projectId: project.id,
      parentId: root.id,
      context: 'Middle context',
    })

    const leaf = await store.tasks.create({
      title: 'Leaf',
      projectId: project.id,
      parentId: middle.id,
    })

    // Update root context
    await store.tasks.update(root.id, { context: 'New root context' }, root.version)

    // Leaf should have the full updated chain
    const updatedLeaf = await store.tasks.get(leaf.id)
    expect(updatedLeaf!.context.inherited).toContain('New root context')
    expect(updatedLeaf!.context.inherited).toContain('Middle context')
  })
})
