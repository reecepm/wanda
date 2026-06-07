import { beforeEach, describe, expect, it } from 'vitest'
import type { TaskStore } from '../store.ts'
import type { Project } from '../types.ts'
import { setupStore } from './helpers.ts'

describe('dependency reconciliation', () => {
  let store: TaskStore
  let project: Project

  beforeEach(async () => {
    const ctx = await setupStore()
    store = ctx.store
    project = ctx.project
  })

  it('transitions pending → ready when all dependencies are met', async () => {
    const dep1 = await store.tasks.create({
      title: 'Dep 1',
      projectId: project.id,
      status: 'ready',
    })
    const dep2 = await store.tasks.create({
      title: 'Dep 2',
      projectId: project.id,
      status: 'ready',
    })

    const task = await store.tasks.create({
      title: 'Waiting',
      projectId: project.id,
      status: 'ready',
      dependsOn: [dep1.id, dep2.id],
    })
    // status was downgraded to 'pending' because of deps
    expect(task.status).toBe('pending')

    // Complete both deps
    await store.tasks.claim(dep1.id, 'agent-1')
    await store.tasks.complete(dep1.id)
    await store.tasks.claim(dep2.id, 'agent-1')
    await store.tasks.complete(dep2.id)

    // Run tick to reconcile
    await store.tick()

    const updated = await store.tasks.get(task.id)
    expect(updated!.status).toBe('ready')
  })

  it('stays pending when some dependencies are not met', async () => {
    const dep1 = await store.tasks.create({
      title: 'Dep 1',
      projectId: project.id,
      status: 'ready',
    })
    const dep2 = await store.tasks.create({
      title: 'Dep 2',
      projectId: project.id,
      status: 'ready',
    })

    const task = await store.tasks.create({
      title: 'Waiting',
      projectId: project.id,
      status: 'ready',
      dependsOn: [dep1.id, dep2.id],
    })

    // Complete only dep1
    await store.tasks.claim(dep1.id, 'agent-1')
    await store.tasks.complete(dep1.id)

    await store.tick()

    const updated = await store.tasks.get(task.id)
    expect(updated!.status).toBe('pending')
  })

  it('transitions pending → ready when task has no dependencies', async () => {
    // Manually create a pending task with empty deps (edge case)
    const task = await store.tasks.create({
      title: 'No Deps But Pending',
      projectId: project.id,
    })
    // Publish to get to pending (will actually go to ready since no deps)
    const published = await store.tasks.publish(task.id)
    expect(published.status).toBe('ready')
  })

  it('handles chain of dependencies', async () => {
    // A depends on B, B depends on C
    const c = await store.tasks.create({
      title: 'C (root)',
      projectId: project.id,
      status: 'ready',
    })
    const b = await store.tasks.create({
      title: 'B (depends on C)',
      projectId: project.id,
      status: 'ready',
      dependsOn: [c.id],
    })
    const a = await store.tasks.create({
      title: 'A (depends on B)',
      projectId: project.id,
      status: 'ready',
      dependsOn: [b.id],
    })

    expect(b.status).toBe('pending')
    expect(a.status).toBe('pending')

    // Complete C
    await store.tasks.claim(c.id, 'agent-1')
    await store.tasks.complete(c.id)

    // First tick: B becomes ready
    await store.tick()
    expect((await store.tasks.get(b.id))!.status).toBe('ready')
    expect((await store.tasks.get(a.id))!.status).toBe('pending')

    // Complete B
    await store.tasks.claim(b.id, 'agent-1')
    await store.tasks.complete(b.id)

    // Second tick: A becomes ready
    await store.tick()
    expect((await store.tasks.get(a.id))!.status).toBe('ready')
  })

  describe('getDependencies / getDependents', () => {
    it('returns direct dependencies', async () => {
      const dep = await store.tasks.create({
        title: 'Dep',
        projectId: project.id,
        status: 'ready',
      })
      const task = await store.tasks.create({
        title: 'Task',
        projectId: project.id,
        dependsOn: [dep.id],
      })

      const deps = await store.tasks.getDependencies(task.id)
      expect(deps).toHaveLength(1)
      expect(deps[0]!.id).toBe(dep.id)
    })

    it('returns dependents (reverse lookup)', async () => {
      const dep = await store.tasks.create({
        title: 'Dep',
        projectId: project.id,
        status: 'ready',
      })
      await store.tasks.create({
        title: 'Dependent 1',
        projectId: project.id,
        dependsOn: [dep.id],
      })
      await store.tasks.create({
        title: 'Dependent 2',
        projectId: project.id,
        dependsOn: [dep.id],
      })

      const dependents = await store.tasks.getDependents(dep.id)
      expect(dependents).toHaveLength(2)
    })
  })
})
