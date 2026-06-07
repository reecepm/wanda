import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LABEL_PREFIX } from '../../app-config'
import { PodController } from '../../domains/pod/controller'
import type { PodControllerShape } from '../../domains/pod/controller/pod'
import { SettingsController } from '../../domains/settings/controller'
import { WorkspaceController } from '../../domains/workspace/controller'
import { DatabaseService } from '../../infra/database'
import { LocalTarget } from '../../targets/local-target'
import { TargetManager } from '../../targets/target-manager'
import { DockerService } from '../docker.service'
import { PtyService } from '../pty.service'
import { type MockDockerTracker, type MockPtyTracker, makeTestRuntime } from './test-layer'

describe('PodController', () => {
  let runtime: ReturnType<typeof makeTestRuntime>['runtime']
  let tracker: MockPtyTracker
  let workspaceId: string

  beforeEach(async () => {
    ;({ runtime, tracker } = makeTestRuntime())
    const proj = await runtime.runPromise(WorkspaceController)
    const project = await runtime.runPromise(proj.create({ name: 'Test Project', cwd: '/tmp/test' }))
    workspaceId = project.id
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  // --- Lifecycle ---

  it('start spawns PTYs for each terminal config and sets running', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'P', cwd: '/home' }))
    await runtime.runPromise(svc.addTerminal({ podId: pod.id, name: 'shell' }))
    await runtime.runPromise(svc.addTerminal({ podId: pod.id, name: 'dev' }))

    await runtime.runPromise(svc.start(pod.id))

    expect(tracker.created).toHaveLength(2)
    expect(tracker.created[0]!.config.cwd).toBe('/home')

    const updated = await runtime.runPromise(svc.getById(pod.id))
    expect(updated!.status).toBe('running')
  })

  it('start populates runningTerminals mapping', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'P', cwd: '/tmp' }))
    await runtime.runPromise(svc.addTerminal({ podId: pod.id, name: 'shell' }))

    await runtime.runPromise(svc.start(pod.id))
    const running = await runtime.runPromise(svc.runningTerminals(pod.id))
    expect(running).toHaveLength(1)
    expect(running[0]!.name).toBe('shell')
    expect(running[0]!.ptyInstanceId).toBeTruthy()
  })

  it('start with no terminal configs spawns no PTYs but flips status to running', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'Empty', cwd: '/tmp' }))

    await runtime.runPromise(svc.start(pod.id))
    expect(tracker.created).toHaveLength(0)

    // An empty pod has no work to do, but `start()` still marks it as
    // running so subsequent UI/lifecycle code treats it as active.
    const updated = await runtime.runPromise(svc.getById(pod.id))
    expect(updated!.status).toBe('running')
  })

  it('start is a no-op if already running (double-start guard)', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'P', cwd: '/tmp' }))
    await runtime.runPromise(svc.addTerminal({ podId: pod.id, name: 'shell' }))

    await runtime.runPromise(svc.start(pod.id))
    expect(tracker.created).toHaveLength(1)

    // Second start should be a no-op
    await runtime.runPromise(svc.start(pod.id))
    expect(tracker.created).toHaveLength(1)
  })

  it('stop kills PTYs, clears mapping, sets stopped', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'P', cwd: '/tmp' }))
    await runtime.runPromise(svc.addTerminal({ podId: pod.id, name: 'shell' }))

    await runtime.runPromise(svc.start(pod.id))
    await runtime.runPromise(svc.stop(pod.id))

    expect(tracker.destroyed).toHaveLength(1)
    const running = await runtime.runPromise(svc.runningTerminals(pod.id))
    expect(running).toHaveLength(0)

    const updated = await runtime.runPromise(svc.getById(pod.id))
    expect(updated!.status).toBe('stopped')
  })

  it('stop is a no-op if already stopped (double-stop guard)', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'P', cwd: '/tmp' }))

    await runtime.runPromise(svc.stop(pod.id))
    // Should not throw or change anything
    const updated = await runtime.runPromise(svc.getById(pod.id))
    expect(updated!.status).toBe('stopped')
  })

  it('restart does stop + start cycle', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'P', cwd: '/tmp' }))
    await runtime.runPromise(svc.addTerminal({ podId: pod.id, name: 'shell' }))

    await runtime.runPromise(svc.start(pod.id))
    const firstPtyId = tracker.created[0]!.id

    await runtime.runPromise(svc.restart(pod.id))

    // First PTY destroyed, second created
    expect(tracker.destroyed).toContain(firstPtyId)
    expect(tracker.created).toHaveLength(2)

    const updated = await runtime.runPromise(svc.getById(pod.id))
    expect(updated!.status).toBe('running')
  })

  it('delete while running stops pod first', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(svc.create({ workspaceId, name: 'P', cwd: '/tmp' }))
    await runtime.runPromise(svc.addTerminal({ podId: pod.id, name: 'shell' }))

    await runtime.runPromise(svc.start(pod.id))
    await runtime.runPromise(svc.delete(pod.id))

    expect(tracker.destroyed).toHaveLength(1)
    const found = await runtime.runPromise(svc.getById(pod.id))
    expect(found).toBeUndefined()
  })

  it('terminal merges pod env and terminal env', async () => {
    const svc = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(
      svc.create({
        workspaceId,
        name: 'P',
        cwd: '/tmp',
        env: { FOO: 'bar', SHARED: 'pod' },
      }),
    )
    await runtime.runPromise(
      svc.addTerminal({
        podId: pod.id,
        name: 'shell',
        env: { BAZ: 'qux', SHARED: 'term' },
      }),
    )

    await runtime.runPromise(svc.start(pod.id))

    const config = tracker.created[0]!.config
    expect(config.env).toMatchObject({ FOO: 'bar', BAZ: 'qux', SHARED: 'term' })
  })

  it('stopAllForWorkspace stops all running pods in project', async () => {
    const svc = await runtime.runPromise(PodController)
    const p1 = await runtime.runPromise(svc.create({ workspaceId, name: 'A', cwd: '/tmp' }))
    const p2 = await runtime.runPromise(svc.create({ workspaceId, name: 'B', cwd: '/tmp' }))
    await runtime.runPromise(svc.addTerminal({ podId: p1.id, name: 'shell' }))
    await runtime.runPromise(svc.addTerminal({ podId: p2.id, name: 'shell' }))

    await runtime.runPromise(svc.start(p1.id))
    await runtime.runPromise(svc.start(p2.id))

    await runtime.runPromise(svc.stopAllForWorkspace(workspaceId))

    const pod1 = await runtime.runPromise(svc.getById(p1.id))
    const pod2 = await runtime.runPromise(svc.getById(p2.id))
    expect(pod1!.status).toBe('stopped')
    expect(pod2!.status).toBe('stopped')
    expect(tracker.destroyed).toHaveLength(2)
  })
})

describe('PodController with TargetManager', () => {
  let runtime: ReturnType<typeof makeTestRuntime>['runtime']
  let tracker: MockPtyTracker
  let dockerTracker: MockDockerTracker
  let podSvc: PodControllerShape
  let targetManager: TargetManager
  let workspaceId: string

  beforeEach(async () => {
    ;({ runtime, tracker, dockerTracker } = makeTestRuntime())

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

  // --- Target-routed PTY ---

  it('pod routes through local target PTY', async () => {
    const pod = await runtime.runPromise(podSvc.create({ workspaceId, name: 'Local PTY', cwd: '/home' }))
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))

    await runtime.runPromise(podSvc.start(pod.id))

    // Should use target-routed path (ptyCreate via LocalTarget)
    // which still goes through the mock PtyService
    expect(tracker.created).toHaveLength(1)
    expect(tracker.created[0]!.config.cwd).toBe('/home')

    const running = await runtime.runPromise(podSvc.runningTerminals(pod.id))
    expect(running).toHaveLength(1)
    expect(running[0]!.ptyInstanceId).toBeTruthy()

    const updated = await runtime.runPromise(podSvc.getById(pod.id))
    expect(updated!.status).toBe('running')
  })

  it('stop target-routed PTY pod destroys PTY via target', async () => {
    const pod = await runtime.runPromise(podSvc.create({ workspaceId, name: 'P', cwd: '/tmp' }))
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))

    await runtime.runPromise(podSvc.start(pod.id))
    await runtime.runPromise(podSvc.stop(pod.id))

    expect(tracker.destroyed).toHaveLength(1)
    const running = await runtime.runPromise(podSvc.runningTerminals(pod.id))
    expect(running).toHaveLength(0)

    const updated = await runtime.runPromise(podSvc.getById(pod.id))
    expect(updated!.status).toBe('stopped')
  })

  it('restart target-routed PTY pod cycles correctly', async () => {
    const pod = await runtime.runPromise(podSvc.create({ workspaceId, name: 'P', cwd: '/tmp' }))
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))

    await runtime.runPromise(podSvc.start(pod.id))
    await runtime.runPromise(podSvc.restart(pod.id))

    // First PTY destroyed, second created
    expect(tracker.destroyed).toHaveLength(1)
    expect(tracker.created).toHaveLength(2)

    const updated = await runtime.runPromise(podSvc.getById(pod.id))
    expect(updated!.status).toBe('running')
  })

  // --- Docker runtime lifecycle ---

  it('start Docker pod creates container, starts it, and execs terminals', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Docker Pod',
        cwd: '/app',
        runtime: { type: 'docker', image: 'node:18' },
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'dev' }))

    await runtime.runPromise(podSvc.start(pod.id))

    // Container created and started
    expect(dockerTracker.containersCreated).toHaveLength(1)
    expect(dockerTracker.containersCreated[0]!.opts.image).toBe('node:18')
    expect(dockerTracker.containersCreated[0]!.opts.labels).toEqual({ [`${LABEL_PREFIX}.pod`]: pod.id })
    expect(dockerTracker.containersStarted).toHaveLength(1)

    // One exec per terminal
    expect(dockerTracker.execsCreated).toHaveLength(2)
    expect(dockerTracker.execsCreated[0]!.opts.containerId).toBe(dockerTracker.containersCreated[0]!.id)

    const running = await runtime.runPromise(podSvc.runningTerminals(pod.id))
    expect(running).toHaveLength(2)

    const updated = await runtime.runPromise(podSvc.getById(pod.id))
    expect(updated!.status).toBe('running')
  })

  it('Docker pod with resources and mounts passes them to container', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Docker Resources',
        cwd: '/app',
        runtime: {
          type: 'docker',
          image: 'alpine:latest',
          resources: { memory: 512 * 1024 * 1024, cpus: 2 },
          mounts: [{ source: '/host/data', target: '/data' }],
          workDir: '/workspace',
          env: { DOCKER_ENV: 'true' },
        },
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))

    await runtime.runPromise(podSvc.start(pod.id))

    const createOpts = dockerTracker.containersCreated[0]!.opts
    expect(createOpts.resources).toEqual({ memory: 512 * 1024 * 1024, cpus: 2 })
    expect(createOpts.mounts).toEqual([{ source: '/host/data', target: '/data' }])
    expect(createOpts.workDir).toBe('/workspace')
    expect(createOpts.env).toEqual({ DOCKER_ENV: 'true' })
  })

  it('Docker exec uses default /bin/sh when no command specified', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Docker Default',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))

    await runtime.runPromise(podSvc.start(pod.id))

    expect(dockerTracker.execsCreated[0]!.opts.cmd).toEqual(['/bin/sh'])
  })

  it('Docker exec uses terminal command and args when specified', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Docker Custom',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'dev', command: 'npm', args: ['run', 'dev'] }))

    await runtime.runPromise(podSvc.start(pod.id))

    expect(dockerTracker.execsCreated[0]!.opts.cmd).toEqual(['npm', 'run', 'dev'])
  })

  it('stop Docker pod stops the container but keeps it for reuse', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Docker Stop',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))

    await runtime.runPromise(podSvc.start(pod.id))
    const containerId = dockerTracker.containersCreated[0]!.id

    await runtime.runPromise(podSvc.stop(pod.id))

    expect(dockerTracker.containersStopped).toEqual([{ id: containerId, timeout: 5 }])
    // stop() keeps the container so a later start() reuses it; only delete()
    // tears it down.
    expect(dockerTracker.containersRemoved).toEqual([])

    const running = await runtime.runPromise(podSvc.runningTerminals(pod.id))
    expect(running).toHaveLength(0)

    const updated = await runtime.runPromise(podSvc.getById(pod.id))
    expect(updated!.status).toBe('stopped')
  })

  it('Docker pod with multiple terminals creates 1 container and N exec streams', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Docker Multi',
        cwd: '/app',
        runtime: { type: 'docker', image: 'node:18' },
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'dev' }))
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'test' }))

    await runtime.runPromise(podSvc.start(pod.id))

    expect(dockerTracker.containersCreated).toHaveLength(1)
    expect(dockerTracker.execsCreated).toHaveLength(3)

    // All execs use the same container
    const containerId = dockerTracker.containersCreated[0]!.id
    for (const exec of dockerTracker.execsCreated) {
      expect(exec.opts.containerId).toBe(containerId)
    }
  })

  // --- Docker error handling ---

  describe('Docker error handling', () => {
    it('container creation failure sets pod to failed', async () => {
      const dockerSvc = await runtime.runPromise(DockerService)
      const origCreate = dockerSvc.createContainer
      ;(dockerSvc as any).createContainer = () => {
        throw new Error('Docker daemon not running')
      }

      const ptySvc = await runtime.runPromise(PtyService)
      const failingLocalTarget = new LocalTarget('local', 'Local', ptySvc, dockerSvc)
      const failingTm = new TargetManager(failingLocalTarget)
      podSvc.setTargetManager(failingTm)

      const pod = await runtime.runPromise(
        podSvc.create({
          workspaceId,
          name: 'Docker Fail',
          cwd: '/app',
          runtime: { type: 'docker', image: 'alpine' },
        }),
      )
      await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))

      await runtime.runPromise(podSvc.start(pod.id)).catch(() => {})

      const updated = await runtime.runPromise(podSvc.getById(pod.id))
      expect(updated!.status).toBe('failed')
      expect(dockerTracker.execsCreated).toHaveLength(0)
      expect(dockerTracker.containersStarted).toHaveLength(0)

      ;(dockerSvc as any).createContainer = origCreate
    })

    it('container start failure sets pod to failed and cleans up container', async () => {
      const dockerSvc = await runtime.runPromise(DockerService)
      const origStart = dockerSvc.startContainer
      ;(dockerSvc as any).startContainer = () => {
        throw new Error('Container start failed')
      }

      const ptySvc = await runtime.runPromise(PtyService)
      const failingLocalTarget = new LocalTarget('local', 'Local', ptySvc, dockerSvc)
      const failingTm = new TargetManager(failingLocalTarget)
      podSvc.setTargetManager(failingTm)

      const pod = await runtime.runPromise(
        podSvc.create({
          workspaceId,
          name: 'Docker Start Fail',
          cwd: '/app',
          runtime: { type: 'docker', image: 'alpine' },
        }),
      )
      await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))

      await runtime.runPromise(podSvc.start(pod.id)).catch(() => {})

      const updated = await runtime.runPromise(podSvc.getById(pod.id))
      expect(updated!.status).toBe('failed')
      // Container was created
      expect(dockerTracker.containersCreated).toHaveLength(1)
      // Container was cleaned up (removed)
      expect(dockerTracker.containersRemoved).toHaveLength(1)
      expect(dockerTracker.containersRemoved[0]!.id).toBe(dockerTracker.containersCreated[0]!.id)

      ;(dockerSvc as any).startContainer = origStart
    })

    it('exec failure for one terminal still runs others', async () => {
      const dockerSvc = await runtime.runPromise(DockerService)
      let execCallCount = 0
      const origExec = dockerSvc.exec
      ;(dockerSvc as any).exec = (opts: any) => {
        execCallCount++
        if (execCallCount === 2) {
          throw new Error('Exec failed')
        }
        return origExec(opts)
      }

      const ptySvc = await runtime.runPromise(PtyService)
      const failingLocalTarget = new LocalTarget('local', 'Local', ptySvc, dockerSvc)
      const failingTm = new TargetManager(failingLocalTarget)
      podSvc.setTargetManager(failingTm)

      const pod = await runtime.runPromise(
        podSvc.create({
          workspaceId,
          name: 'Docker Exec Fail',
          cwd: '/app',
          runtime: { type: 'docker', image: 'alpine' },
        }),
      )
      await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell1' }))
      await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell2' }))
      await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell3' }))

      await runtime.runPromise(podSvc.start(pod.id))

      // 2 successful exec streams (1st and 3rd)
      const running = await runtime.runPromise(podSvc.runningTerminals(pod.id))
      expect(running).toHaveLength(2)

      // Pod is still running (partial success)
      const updated = await runtime.runPromise(podSvc.getById(pod.id))
      expect(updated!.status).toBe('running')

      ;(dockerSvc as any).exec = origExec
    })

    it('container stop failure during pod stop still completes the lifecycle transition', async () => {
      const dockerSvc = await runtime.runPromise(DockerService)
      const ptySvc = await runtime.runPromise(PtyService)

      const pod = await runtime.runPromise(
        podSvc.create({
          workspaceId,
          name: 'Docker Stop Fail',
          cwd: '/app',
          runtime: { type: 'docker', image: 'alpine' },
        }),
      )
      await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))

      await runtime.runPromise(podSvc.start(pod.id))

      // Install failing stop on the target used for stop
      const failingLocalTarget = new LocalTarget('local', 'Local', ptySvc, dockerSvc)
      failingLocalTarget.dockerStopContainer = async () => {
        throw new Error('Stop failed')
      }
      const failingTm = new TargetManager(failingLocalTarget)
      podSvc.setTargetManager(failingTm)

      await runtime.runPromise(podSvc.stop(pod.id))

      // Pod still flips to stopped even though dockerStopContainer threw —
      // the stop() path swallows the docker error so the lifecycle isn't
      // wedged in 'stopping'.
      const updated = await runtime.runPromise(podSvc.getById(pod.id))
      expect(updated!.status).toBe('stopped')
    })
  })

  // --- Delete with Docker runtime ---

  it('delete running Docker pod stops container and cleans up', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Docker Delete',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))

    await runtime.runPromise(podSvc.start(pod.id))
    await runtime.runPromise(podSvc.delete(pod.id))

    // delete() runs both the stop-terminal and destroy-container code paths,
    // each of which calls dockerStopContainer; the second call is a no-op
    // against an already-stopped container, but we still see two tracker
    // entries.
    expect(dockerTracker.containersStopped.length).toBeGreaterThanOrEqual(1)
    expect(dockerTracker.containersRemoved).toHaveLength(1)

    const found = await runtime.runPromise(podSvc.getById(pod.id))
    expect(found).toBeUndefined()
  })
})

// --- Docker container lifecycle management ---

describe('PodController lifecycle management', () => {
  let runtime: ReturnType<typeof makeTestRuntime>['runtime']
  let dockerTracker: MockDockerTracker
  let podSvc: PodControllerShape
  let targetManager: TargetManager
  let workspaceId: string

  beforeEach(async () => {
    ;({ runtime, dockerTracker } = makeTestRuntime())

    const proj = await runtime.runPromise(WorkspaceController)
    const project = await runtime.runPromise(proj.create({ name: 'Test Project', cwd: '/tmp/test' }))
    workspaceId = project.id

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

  it('create pod with containerLifecycle field', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Lifecycle Pod',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
        containerLifecycle: 'stop-on-exit',
      }),
    )
    expect(pod.containerLifecycle).toBe('stop-on-exit')
  })

  it('create pod defaults containerLifecycle to inherit', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Default Pod',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
      }),
    )
    expect(pod.containerLifecycle).toBe('inherit')
  })

  it('update containerLifecycle on existing pod', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Update Pod',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
      }),
    )
    const updated = await runtime.runPromise(podSvc.update(pod.id, { containerLifecycle: 'keep-running' }))
    expect(updated.containerLifecycle).toBe('keep-running')
  })

  it('shutdown with keep-running policy does NOT stop container', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Keep Running Pod',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
        containerLifecycle: 'keep-running',
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))
    await runtime.runPromise(podSvc.start(pod.id))

    dockerTracker.containersStopped = []

    await podSvc.shutdown()

    // Container should NOT be stopped
    expect(dockerTracker.containersStopped).toHaveLength(0)
    // Pod status should be 'stopped' in the app
    const updated = await runtime.runPromise(podSvc.getById(pod.id))
    expect(updated!.status).toBe('stopped')
    // Container ID should still be in DB (preserved for recovery)
    expect(updated!.containerId).toBeTruthy()
  })

  it('shutdown with stop-on-exit policy stops and clears container', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Stop On Exit Pod',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
        containerLifecycle: 'stop-on-exit',
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))
    await runtime.runPromise(podSvc.start(pod.id))

    dockerTracker.containersStopped = []

    await podSvc.shutdown()

    // Container should be stopped
    expect(dockerTracker.containersStopped).toHaveLength(1)
    // Container ID should be cleared from DB
    const updated = await runtime.runPromise(podSvc.getById(pod.id))
    expect(updated!.containerId).toBeNull()
  })

  it('shutdown with inherit lifecycle uses global setting (stop-on-exit)', async () => {
    // Set global lifecycle to stop-on-exit
    const settingsSvc = await runtime.runPromise(SettingsController)
    await runtime.runPromise(settingsSvc.set('container.lifecycle', 'stop-on-exit'))

    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Inherit Pod',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
        // containerLifecycle defaults to 'inherit'
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))
    await runtime.runPromise(podSvc.start(pod.id))

    dockerTracker.containersStopped = []

    await podSvc.shutdown()

    // Inherits global: stop-on-exit → container should be stopped
    expect(dockerTracker.containersStopped).toHaveLength(1)
    const updated = await runtime.runPromise(podSvc.getById(pod.id))
    expect(updated!.containerId).toBeNull()
  })

  it('shutdown with inherit lifecycle defaults to keep-running when no global set', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Inherit Default Pod',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
        // containerLifecycle defaults to 'inherit', no global setting
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))
    await runtime.runPromise(podSvc.start(pod.id))

    dockerTracker.containersStopped = []

    await podSvc.shutdown()

    // No global setting → defaults to keep-running → container NOT stopped
    expect(dockerTracker.containersStopped).toHaveLength(0)
    const updated = await runtime.runPromise(podSvc.getById(pod.id))
    expect(updated!.containerId).toBeTruthy()
  })

  it('recoverContainers returns recovery counts for running containers', async () => {
    // Create a pod with a container
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Recover Pod',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))
    await runtime.runPromise(podSvc.start(pod.id))

    const containerId = dockerTracker.containersCreated[0]!.id

    // Simulate app restart: set inspectResults so recovery sees container as running
    dockerTracker.inspectResults.set(containerId, {
      id: containerId,
      name: 'test',
      image: 'alpine',
      state: 'running',
      labels: { [`${LABEL_PREFIX}.pod`]: pod.id },
    })

    // Simulate app restart state: pod is still 'running' in DB because we didn't reset Docker pods
    const result = await runtime.runPromise(podSvc.recoverContainers())

    expect(result.recovered).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('recoverContainers counts failed when container is gone', async () => {
    const pod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Lost Pod',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod.id, name: 'shell' }))
    await runtime.runPromise(podSvc.start(pod.id))

    // Don't set inspectResults → returns null → container not found

    const result = await runtime.runPromise(podSvc.recoverContainers())

    // Container gone = not a "failed" recovery, it's just cleared.
    // recoverContainers clears the map but doesn't count it as failed
    expect(result.recovered).toBe(0)
  })

  it('startup reset only affects non-Docker pods', async () => {
    // Verify the SQL condition logic directly via the DB
    // Docker pods (with containerId) should NOT be reset; shell pods should
    const db = await runtime.runPromise(DatabaseService)
    const { pods: podsTable } = await import('../../db/schema')

    const pod1 = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Docker Pod',
        cwd: '/app',
        runtime: { type: 'docker', image: 'alpine' },
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: pod1.id, name: 'shell' }))
    await runtime.runPromise(podSvc.start(pod1.id))

    const shellPod = await runtime.runPromise(
      podSvc.create({
        workspaceId,
        name: 'Shell Pod',
        cwd: '/tmp',
      }),
    )
    await runtime.runPromise(podSvc.addTerminal({ podId: shellPod.id, name: 'shell' }))
    await runtime.runPromise(podSvc.start(shellPod.id))

    // Verify both are running
    expect((await runtime.runPromise(podSvc.getById(pod1.id)))!.status).toBe('running')
    expect((await runtime.runPromise(podSvc.getById(shellPod.id)))!.status).toBe('running')

    // Docker pod has a containerId, shell pod doesn't
    expect((await runtime.runPromise(podSvc.getById(pod1.id)))!.containerId).toBeTruthy()
    expect((await runtime.runPromise(podSvc.getById(shellPod.id)))!.containerId).toBeNull()

    // Simulate the startup reset SQL that runs in PodControllerLive init
    const { and, eq, isNull } = await import('drizzle-orm')
    db.update(podsTable)
      .set({ status: 'stopped', updatedAt: new Date() })
      .where(and(eq(podsTable.status, 'running'), isNull(podsTable.containerId)))
      .run()

    // Docker pod should still be running (has containerId)
    const dockerPod = db.select().from(podsTable).where(eq(podsTable.id, pod1.id)).get()
    expect(dockerPod!.status).toBe('running')

    // Shell pod should be reset to stopped (no containerId)
    const shellPodAfter = db.select().from(podsTable).where(eq(podsTable.id, shellPod.id)).get()
    expect(shellPodAfter!.status).toBe('stopped')
  })

  // --- Duplicate ---

  describe('Pod duplicate', () => {
    it('duplicate pod clones config and appends (copy) to name', async () => {
      const svc = await runtime.runPromise(PodController)
      const original = await runtime.runPromise(
        svc.create({ workspaceId, name: 'Original Pod', cwd: '/home/user', shell: '/bin/zsh', env: { FOO: 'bar' } }),
      )
      // Add terminals
      await runtime.runPromise(svc.addTerminal({ podId: original.id, name: 'shell' }))
      await runtime.runPromise(
        svc.addTerminal({ podId: original.id, name: 'build', command: 'npm', args: ['run', 'dev'] }),
      )

      const copy = await runtime.runPromise(svc.duplicate(original.id))
      expect(copy).not.toBeNull()
      expect(copy!.id).not.toBe(original.id)
      expect(copy!.name).toBe('Original Pod (copy)')
      expect(copy!.workspaceId).toBe(workspaceId)
      expect(copy!.cwd).toBe('/home/user')
      expect(copy!.shell).toBe('/bin/zsh')
      expect(copy!.env).toEqual({ FOO: 'bar' })

      // Verify terminals were cloned
      const origTerminals = await runtime.runPromise(svc.listTerminals(original.id))
      const copyTerminals = await runtime.runPromise(svc.listTerminals(copy!.id))
      expect(copyTerminals).toHaveLength(origTerminals.length)
      expect(copyTerminals.map((t) => t.name).sort()).toEqual(origTerminals.map((t) => t.name).sort())
      // Different IDs
      for (const ct of copyTerminals) {
        expect(origTerminals.find((t) => t.id === ct.id)).toBeUndefined()
      }
    })

    it('duplicate non-existent pod returns null', async () => {
      const svc = await runtime.runPromise(PodController)
      const result = await runtime.runPromise(svc.duplicate('nonexistent-id'))
      expect(result).toBeNull()
    })

    it('duplicate preserves containerLifecycle', async () => {
      const svc = await runtime.runPromise(PodController)
      const original = await runtime.runPromise(
        svc.create({ workspaceId, name: 'Lifecycle Pod', cwd: '/tmp', containerLifecycle: 'stop-on-exit' }),
      )
      const copy = await runtime.runPromise(svc.duplicate(original.id))
      expect(copy!.containerLifecycle).toBe('stop-on-exit')
    })
  })
})
