import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PodController } from '../../domains/pod/controller'
import { WorkspaceController } from '../../domains/workspace/controller'
import { makeTestRuntime } from './test-layer'

describe('WorkspaceController', () => {
  let runtime: ReturnType<typeof makeTestRuntime>['runtime']

  beforeEach(async () => {
    ;({ runtime } = makeTestRuntime())
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it('list returns all projects', async () => {
    const svc = await runtime.runPromise(WorkspaceController)

    await runtime.runPromise(svc.create({ name: 'P1', cwd: '/tmp/p1' }))
    await runtime.runPromise(svc.create({ name: 'P2', cwd: '/tmp/p2' }))
    await runtime.runPromise(svc.create({ name: 'P3', cwd: '/tmp/p3' }))

    const list = await runtime.runPromise(svc.list())
    expect(list).toHaveLength(3)
    expect(list.map((p) => p.name).sort()).toEqual(['P1', 'P2', 'P3'])
  })

  it('create generates ID and timestamps', async () => {
    const svc = await runtime.runPromise(WorkspaceController)
    const project = await runtime.runPromise(svc.create({ name: 'My Project', cwd: '/tmp/proj', repoPath: '/tmp' }))
    expect(project.id).toBeTruthy()
    expect(project.name).toBe('My Project')
    expect(project.cwd).toBe('/tmp/proj')
    expect(project.repoPath).toBe('/tmp')
  })

  it('getById returns project', async () => {
    const svc = await runtime.runPromise(WorkspaceController)
    const project = await runtime.runPromise(svc.create({ name: 'Find Me', cwd: '/tmp' }))
    const found = await runtime.runPromise(svc.getById(project.id))
    expect(found).toBeDefined()
    expect(found!.name).toBe('Find Me')
  })

  it('update partial fields', async () => {
    const svc = await runtime.runPromise(WorkspaceController)
    const project = await runtime.runPromise(svc.create({ name: 'Original', cwd: '/tmp' }))

    const updated = await runtime.runPromise(svc.update(project.id, { name: 'Renamed' }))
    expect(updated.name).toBe('Renamed')
  })

  it('delete cascades to pods and podTerminals', async () => {
    const projSvc = await runtime.runPromise(WorkspaceController)
    const podSvc = await runtime.runPromise(PodController)

    const project = await runtime.runPromise(projSvc.create({ name: 'Cascade Test', cwd: '/tmp' }))
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId: project.id,
        name: 'Test Pod',
        cwd: '/tmp',
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))

    // Verify pod and terminal exist
    const podsBefore = await runtime.runPromise(podSvc.listByWorkspace(project.id))
    expect(podsBefore).toHaveLength(1)
    const termsBefore = await runtime.runPromise(podSvc.listTerminals(pod.id))
    expect(termsBefore).toHaveLength(1)

    // Delete project → cascade
    await runtime.runPromise(projSvc.delete(project.id))

    const podsAfter = await runtime.runPromise(podSvc.listByWorkspace(project.id))
    expect(podsAfter).toHaveLength(0)
    const termsAfter = await runtime.runPromise(podSvc.listTerminals(pod.id))
    expect(termsAfter).toHaveLength(0)
  })
})
