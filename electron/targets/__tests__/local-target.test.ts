import { Layer, ManagedRuntime } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type MockDockerTracker,
  type MockPtyTracker,
  makeTestDockerLayer,
  makeTestPtyLayer,
} from '../../services/__tests__/test-layer'
import { DockerService } from '../../services/docker.service'
import { PtyService } from '../../services/pty.service'
import { LocalTarget } from '../local-target'

describe('LocalTarget', () => {
  let target: LocalTarget
  let ptyTracker: MockPtyTracker
  let dockerTracker: MockDockerTracker
  let runtime: ManagedRuntime.ManagedRuntime<PtyService | DockerService, never>

  beforeEach(() => {
    const { layer: ptyLayer, tracker: pt } = makeTestPtyLayer()
    const { layer: dockerLayer, tracker: dt } = makeTestDockerLayer()
    ptyTracker = pt
    dockerTracker = dt

    const layer = Layer.mergeAll(ptyLayer, dockerLayer)
    runtime = ManagedRuntime.make(layer)

    const ptyService = runtime.runSync(PtyService)
    const dockerService = runtime.runSync(DockerService)

    target = new LocalTarget('local', 'Local Machine', ptyService, dockerService)
  })

  afterEach(async () => {
    await target.disconnect()
    await runtime.dispose()
  })

  // --- Lifecycle ---

  describe('lifecycle', () => {
    it('has status connected', () => {
      expect(target.status).toBe('connected')
    })

    it('has type local', () => {
      expect(target.type).toBe('local')
    })

    it('connect is a no-op', async () => {
      await target.connect()
      expect(target.status).toBe('connected')
    })

    it('disconnect sets status to disconnected', async () => {
      await target.disconnect()
      expect(target.status).toBe('disconnected')
    })
  })

  // --- PTY operations ---

  describe('PTY operations', () => {
    it('ptyCreate delegates to service and returns id', async () => {
      const id = await target.ptyCreate({ cwd: '/tmp' })
      expect(id).toBeTruthy()
      expect(ptyTracker.created).toHaveLength(1)
      expect(ptyTracker.created[0]!.config.cwd).toBe('/tmp')
    })

    it('ptyWrite delegates to service', () => {
      target.ptyWrite('pty-1', 'hello')
      expect(ptyTracker.writes).toContainEqual({ id: 'pty-1', data: 'hello' })
    })

    it('ptyDestroy delegates to service', async () => {
      const id = await target.ptyCreate({ cwd: '/tmp' })
      await target.ptyDestroy(id)
      expect(ptyTracker.destroyed).toContain(id)
    })

    it('ptyGetScrollback returns scrollback data', async () => {
      ptyTracker.scrollbackData.set('pty-1', 'scrollback content')
      const result = await target.ptyGetScrollback('pty-1')
      expect(result).toBe('scrollback content')
    })
  })

  // --- Docker operations ---

  describe('Docker operations', () => {
    it('dockerCreateContainer delegates to service', async () => {
      const id = await target.dockerCreateContainer({ image: 'alpine' })
      expect(id).toBeTruthy()
      expect(dockerTracker.containersCreated).toHaveLength(1)
      expect(dockerTracker.containersCreated[0]!.opts.image).toBe('alpine')
    })

    it('dockerStartContainer delegates to service', async () => {
      await target.dockerStartContainer('c1')
      expect(dockerTracker.containersStarted).toContain('c1')
    })

    it('dockerStopContainer delegates to service', async () => {
      await target.dockerStopContainer('c1', 5)
      expect(dockerTracker.containersStopped).toContainEqual({ id: 'c1', timeout: 5 })
    })

    it('dockerRemoveContainer delegates to service', async () => {
      await target.dockerRemoveContainer('c1')
      expect(dockerTracker.containersRemoved).toContainEqual({ id: 'c1', force: undefined })
    })

    it('dockerExec delegates to service', async () => {
      const streamId = await target.dockerExec({ containerId: 'c1', cmd: ['/bin/bash'] })
      expect(streamId).toBeTruthy()
      expect(dockerTracker.execsCreated).toHaveLength(1)
    })

    it('dockerPullImage yields progress', async () => {
      const progress: import('../../services/docker.service').PullProgress[] = []
      for await (const p of target.dockerPullImage('alpine')) {
        progress.push(p)
      }
      expect(progress.length).toBeGreaterThan(0)
      expect(dockerTracker.imagesPulled).toContain('alpine')
    })
  })

  // --- Stream events ---

  describe('stream events', () => {
    it('onStreamData receives PTY data', () => {
      const received: string[] = []
      target.onStreamData('pty-1', (data) => received.push(data))
      ptyTracker.triggerAnyData('pty-1', 'hello')
      expect(received).toEqual(['hello'])
    })

    it('onStreamData receives Docker exec data', () => {
      const received: string[] = []
      target.onStreamData('exec-1', (data) => received.push(data))
      dockerTracker.triggerAnyExecData('exec-1', 'exec output')
      expect(received).toEqual(['exec output'])
    })

    it('onStreamExit receives PTY exit', () => {
      const received: number[] = []
      target.onStreamExit('pty-1', (code) => received.push(code))
      ptyTracker.triggerAnyExit('pty-1', 0)
      expect(received).toEqual([0])
    })

    it('onStreamExit receives Docker exec exit', () => {
      const received: number[] = []
      target.onStreamExit('exec-1', (code) => received.push(code))
      dockerTracker.triggerAnyExecExit('exec-1', 137)
      expect(received).toEqual([137])
    })

    it('unsubscribe stops events', () => {
      const received: string[] = []
      const unsub = target.onStreamData('pty-1', (data) => received.push(data))
      ptyTracker.triggerAnyData('pty-1', 'before')
      unsub()
      ptyTracker.triggerAnyData('pty-1', 'after')
      expect(received).toEqual(['before'])
    })

    it('data for non-subscribed stream is ignored', () => {
      const received: string[] = []
      target.onStreamData('pty-1', (data) => received.push(data))
      ptyTracker.triggerAnyData('pty-other', 'should be ignored')
      expect(received).toEqual([])
    })

    it('disconnect stops events from firing', async () => {
      const received: string[] = []
      target.onStreamData('pty-1', (data) => received.push(data))
      await target.disconnect()
      ptyTracker.triggerAnyData('pty-1', 'after disconnect')
      expect(received).toEqual([])
    })
  })

  // --- System resources ---

  describe('systemResources', () => {
    it('returns local system info', async () => {
      const info = await target.systemResources()
      expect(info.hostname).toBeTruthy()
      expect(info.cpus).toBeGreaterThan(0)
      expect(info.memoryTotal).toBeGreaterThan(0)
      expect(info.memoryFree).toBeGreaterThan(0)
      expect(info.diskTotal).toBeGreaterThan(0)
      expect(info.diskFree).toBeGreaterThan(0)
      expect(info.dockerAvailable).toBe(true)
    })
  })
})
