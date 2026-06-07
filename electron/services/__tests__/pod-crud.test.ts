import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PodController } from '../../domains/pod/controller'
import type { PodControllerShape } from '../../domains/pod/controller/pod'
import { WorkspaceController } from '../../domains/workspace/controller'
import { LocalTarget } from '../../targets/local-target'
import { TargetManager } from '../../targets/target-manager'
import { DockerService } from '../docker.service'
import { PtyService } from '../pty.service'
import { makeTestRuntime } from './test-layer'

describe('PodController', () => {
  let runtime: ReturnType<typeof makeTestRuntime>['runtime']
  let workspaceId: string

  beforeEach(async () => {
    ;({ runtime } = makeTestRuntime())
    const proj = await runtime.runPromise(WorkspaceController)
    const project = await runtime.runPromise(proj.create({ name: 'Test Project', cwd: '/tmp/test' }))
    workspaceId = project.id
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  // --- CRUD ---

  it('create pod with generated ID', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(
      svc.create({
        workspaceId,
        name: 'My Pod',
        cwd: '/tmp',
        shell: '/bin/zsh',
      }),
    )
    expect(pod.id).toBeTruthy()
    expect(pod.name).toBe('My Pod')
    expect(pod.cwd).toBe('/tmp')
    expect(pod.shell).toBe('/bin/zsh')
    expect(pod.status).toBe('stopped')
  })

  it('listByWorkspace returns pods for project', async () => {
    const svc = await runtime.runPromise(PodController)
    await runtime.runPromise(svc.create({ workspaceId, name: 'A', cwd: '/tmp' }))
    await runtime.runPromise(svc.create({ workspaceId, name: 'B', cwd: '/tmp' }))
    const list = await runtime.runPromise(svc.listByWorkspace(workspaceId))
    expect(list).toHaveLength(2)
  })

  it('getById returns pod', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'Find', cwd: '/tmp' }))
    const found = await runtime.runPromise(svc.getById(pod.id))
    expect(found).toBeDefined()
    expect(found!.name).toBe('Find')
  })

  it('update partial fields', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'Old', cwd: '/tmp' }))
    const updated = await runtime.runPromise(svc.update(pod.id, { name: 'New' }))
    expect(updated.name).toBe('New')
    expect(updated.cwd).toBe('/tmp')
  })

  it('delete removes pod', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'Del', cwd: '/tmp' }))
    await runtime.runPromise(svc.delete(pod.id))
    const found = await runtime.runPromise(svc.getById(pod.id))
    expect(found).toBeUndefined()
  })

  // --- Terminal config CRUD ---

  it('addTerminal and listTerminals', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'P', cwd: '/tmp' }))
    const term = await runtime.runPromise(svc.addTerminal({ podId: pod.id, name: 'shell' }))
    expect(term.id).toBeTruthy()
    expect(term.name).toBe('shell')
    expect(term.podId).toBe(pod.id)

    const list = await runtime.runPromise(svc.listTerminals(pod.id))
    expect(list).toHaveLength(1)
  })

  it('updateTerminal', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'P', cwd: '/tmp' }))
    const term = await runtime.runPromise(svc.addTerminal({ podId: pod.id, name: 'old' }))
    const updated = await runtime.runPromise(svc.updateTerminal(term.id, { name: 'new', command: 'bash' }))
    expect(updated.name).toBe('new')
    expect(updated.command).toBe('bash')
  })

  it('removeTerminal', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'P', cwd: '/tmp' }))
    const term = await runtime.runPromise(svc.addTerminal({ podId: pod.id, name: 'shell' }))
    await runtime.runPromise(svc.removeTerminal(term.id))
    const list = await runtime.runPromise(svc.listTerminals(pod.id))
    expect(list).toHaveLength(0)
  })
})

// --- D7: Target routing + Docker runtime ---

describe('PodController with TargetManager', () => {
  let runtime: ReturnType<typeof makeTestRuntime>['runtime']
  let podSvc: PodControllerShape
  let targetManager: TargetManager
  let workspaceId: string

  beforeEach(async () => {
    ;({ runtime } = makeTestRuntime())

    const proj = await runtime.runPromise(WorkspaceController)
    const project = await runtime.runPromise(proj.create({ name: 'Test Project', cwd: '/tmp/test' }))
    workspaceId = project.id

    // Wire TargetManager into PodController
    const ptySvc = await runtime.runPromise(PtyService)
    const dockerSvc = await runtime.runPromise(DockerService)
    const localTarget = new LocalTarget('local', 'Local', ptySvc, dockerSvc)
    targetManager = new TargetManager(localTarget)

    podSvc = await runtime.runPromise(PodController)
    podSvc.setTargetManager(targetManager)
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it('update pod runtime', async () => {
    const pod = await runtime.runPromise(podSvc.create({ workspaceId, name: 'P', cwd: '/tmp' }))
    const updated = await runtime.runPromise(
      podSvc.update(pod.id, {
        runtime: { type: 'docker', image: 'alpine' },
      }),
    )
    expect(updated.runtime).toEqual({ type: 'docker', image: 'alpine' })
  })
})
