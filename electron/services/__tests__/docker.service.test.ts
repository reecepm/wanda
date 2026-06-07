import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DockerService } from '../docker.service'
import { type MockDockerTracker, makeTestRuntime } from './test-layer'

describe('DockerService', () => {
  let runtime: ReturnType<typeof makeTestRuntime>['runtime']
  let tracker: MockDockerTracker

  beforeEach(() => {
    ;({ runtime, dockerTracker: tracker } = makeTestRuntime())
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  // --- Container lifecycle ---

  it('createContainer returns an ID and tracks opts', async () => {
    const svc = await runtime.runPromise(DockerService)
    const id = await runtime.runPromise(svc.createContainer({ image: 'alpine:latest', name: 'test-container' }))
    expect(id).toBeTruthy()
    expect(tracker.containersCreated).toHaveLength(1)
    expect(tracker.containersCreated[0]!.opts.image).toBe('alpine:latest')
    expect(tracker.containersCreated[0]!.opts.name).toBe('test-container')
  })

  it('createContainer with resources, mounts, labels', async () => {
    const svc = await runtime.runPromise(DockerService)
    await runtime.runPromise(
      svc.createContainer({
        image: 'ubuntu:22.04',
        resources: { memory: 4 * 1024 ** 3, cpus: 2 },
        mounts: [{ source: '/host/path', target: '/container/path', readonly: true }],
        labels: { 'wanda.pod': 'pod-123' },
        env: { FOO: 'bar' },
        workDir: '/app',
      }),
    )
    const opts = tracker.containersCreated[0]!.opts
    expect(opts.resources?.memory).toBe(4 * 1024 ** 3)
    expect(opts.resources?.cpus).toBe(2)
    expect(opts.mounts).toHaveLength(1)
    expect(opts.mounts![0]!.readonly).toBe(true)
    expect(opts.labels!['wanda.pod']).toBe('pod-123')
    expect(opts.env!.FOO).toBe('bar')
    expect(opts.workDir).toBe('/app')
  })

  it('startContainer tracks the call', async () => {
    const svc = await runtime.runPromise(DockerService)
    const id = await runtime.runPromise(svc.createContainer({ image: 'alpine' }))
    await runtime.runPromise(svc.startContainer(id))
    expect(tracker.containersStarted).toContain(id)
  })

  it('stopContainer tracks id and timeout', async () => {
    const svc = await runtime.runPromise(DockerService)
    const id = await runtime.runPromise(svc.createContainer({ image: 'alpine' }))
    await runtime.runPromise(svc.stopContainer(id, 5))
    expect(tracker.containersStopped).toEqual([{ id, timeout: 5 }])
  })

  it('removeContainer tracks id and force flag', async () => {
    const svc = await runtime.runPromise(DockerService)
    const id = await runtime.runPromise(svc.createContainer({ image: 'alpine' }))
    await runtime.runPromise(svc.removeContainer(id, true))
    expect(tracker.containersRemoved).toEqual([{ id, force: true }])
  })

  it('listContainers returns empty array by default', async () => {
    const svc = await runtime.runPromise(DockerService)
    const list = await runtime.runPromise(svc.listContainers())
    expect(list).toEqual([])
  })

  // --- Exec ---

  it('exec returns stream ID and tracks opts', async () => {
    const svc = await runtime.runPromise(DockerService)
    const streamId = await runtime.runPromise(svc.exec({ containerId: 'c1', cmd: ['/bin/bash'] }))
    expect(streamId).toBeTruthy()
    expect(tracker.execsCreated).toHaveLength(1)
    expect(tracker.execsCreated[0]!.opts.containerId).toBe('c1')
    expect(tracker.execsCreated[0]!.opts.cmd).toEqual(['/bin/bash'])
  })

  it('execWrite and execResize are tracked', async () => {
    const svc = await runtime.runPromise(DockerService)
    const streamId = await runtime.runPromise(svc.exec({ containerId: 'c1', cmd: ['/bin/bash'] }))
    svc.execWrite(streamId, 'ls\n')
    svc.execResize(streamId, 120, 40)
    expect(tracker.execWrites).toEqual([{ streamId, data: 'ls\n' }])
    expect(tracker.execResizes).toEqual([{ streamId, cols: 120, rows: 40 }])
  })

  it('getExecScrollback returns empty for unknown stream', async () => {
    const svc = await runtime.runPromise(DockerService)
    expect(svc.getExecScrollback('nonexistent')).toBe('')
  })

  it('destroyExecStream tracks the call', async () => {
    const svc = await runtime.runPromise(DockerService)
    const streamId = await runtime.runPromise(svc.exec({ containerId: 'c1', cmd: ['/bin/bash'] }))
    svc.destroyExecStream(streamId)
    expect(tracker.execsDestroyed).toContain(streamId)
  })

  it('destroyAllExecStreams tracks the call', async () => {
    const svc = await runtime.runPromise(DockerService)
    svc.destroyAllExecStreams()
    expect(tracker.execsDestroyed).toContain('__all__')
  })

  // --- Callbacks ---

  it('onExecData callback fires when triggered', async () => {
    const svc = await runtime.runPromise(DockerService)
    const streamId = await runtime.runPromise(svc.exec({ containerId: 'c1', cmd: ['/bin/bash'] }))
    const received: string[] = []
    svc.onExecData(streamId, (data) => received.push(data))

    tracker.triggerExecData(streamId, 'hello')
    tracker.triggerExecData(streamId, ' world')

    expect(received).toEqual(['hello', ' world'])
  })

  it('onExecExit callback fires when triggered', async () => {
    const svc = await runtime.runPromise(DockerService)
    const streamId = await runtime.runPromise(svc.exec({ containerId: 'c1', cmd: ['/bin/bash'] }))
    let exitCode = -1
    svc.onExecExit(streamId, (code) => {
      exitCode = code
    })

    tracker.triggerExecExit(streamId, 0)
    expect(exitCode).toBe(0)
  })

  it('onExecData unsubscribe stops delivery', async () => {
    const svc = await runtime.runPromise(DockerService)
    const streamId = await runtime.runPromise(svc.exec({ containerId: 'c1', cmd: ['/bin/bash'] }))
    const received: string[] = []
    const unsub = svc.onExecData(streamId, (data) => received.push(data))

    tracker.triggerExecData(streamId, 'before')
    unsub()
    tracker.triggerExecData(streamId, 'after')

    expect(received).toEqual(['before'])
  })

  it('onExecData for unknown stream returns no-op unsubscribe', async () => {
    const svc = await runtime.runPromise(DockerService)
    const unsub = svc.onExecData('nonexistent', () => {})
    expect(typeof unsub).toBe('function')
    unsub() // should not throw
  })

  // --- Image operations ---

  it('pullImage yields progress events', async () => {
    const svc = await runtime.runPromise(DockerService)
    const events: { status: string }[] = []
    for await (const p of svc.pullImage('alpine:latest')) {
      events.push(p)
    }
    expect(events).toHaveLength(2)
    expect(events[0]!.status).toBe('Pulling from library/alpine')
    expect(tracker.imagesPulled).toContain('alpine:latest')
  })

  it('listImages returns empty array by default', async () => {
    const svc = await runtime.runPromise(DockerService)
    const list = await runtime.runPromise(svc.listImages())
    expect(list).toEqual([])
  })

  // --- System ---

  it('checkDockerAvailable returns boolean', async () => {
    const svc = await runtime.runPromise(DockerService)
    const available = await runtime.runPromise(svc.checkDockerAvailable())
    expect(available).toBe(true)

    tracker.dockerAvailable = false
    const unavailable = await runtime.runPromise(svc.checkDockerAvailable())
    expect(unavailable).toBe(false)
  })

  it('cleanupOrphanContainers returns count', async () => {
    tracker.preseededContainers = [
      { id: 'c1', name: 'p1', image: 'alpine', state: 'running', labels: { 'wanda.pod': 'p1' } },
      { id: 'c2', name: 'p2', image: 'alpine', state: 'exited', labels: { 'wanda.pod': 'p2' } },
      { id: 'c3', name: 'p3', image: 'alpine', state: 'running', labels: { 'wanda.pod': 'p3' } },
    ]
    const svc = await runtime.runPromise(DockerService)
    const count = await runtime.runPromise(svc.cleanupOrphanContainers())
    expect(count).toBe(3)
  })

  // --- Orphan container cleanup ---

  describe('orphan container cleanup', () => {
    it('cleans up running and stopped containers', async () => {
      tracker.preseededContainers = [
        { id: 'c-running', name: 'pod-1', image: 'alpine', state: 'running', labels: { 'wanda.pod': 'p1' } },
        { id: 'c-exited', name: 'pod-2', image: 'alpine', state: 'exited', labels: { 'wanda.pod': 'p2' } },
        { id: 'c-running-2', name: 'pod-3', image: 'node:18', state: 'running', labels: { 'wanda.pod': 'p3' } },
      ]

      const svc = await runtime.runPromise(DockerService)
      const count = await runtime.runPromise(svc.cleanupOrphanContainers())

      expect(count).toBe(3)

      // Running containers were stopped with timeout
      expect(tracker.containersStopped).toEqual([
        { id: 'c-running', timeout: 2 },
        { id: 'c-running-2', timeout: 2 },
      ])

      // All containers were removed (force: true)
      expect(tracker.containersRemoved).toEqual([
        { id: 'c-running', force: true },
        { id: 'c-exited', force: true },
        { id: 'c-running-2', force: true },
      ])
    })

    it('no-op when no orphans exist', async () => {
      tracker.preseededContainers = []

      const svc = await runtime.runPromise(DockerService)
      const count = await runtime.runPromise(svc.cleanupOrphanContainers())

      expect(count).toBe(0)
      expect(tracker.containersStopped).toHaveLength(0)
      expect(tracker.containersRemoved).toHaveLength(0)
    })
  })

  // --- Exec scrollback buffer ---

  describe('exec scrollback buffer', () => {
    const SCROLLBACK_BUFFER_SIZE = 100_000

    // Replicate the scrollback buffer algorithm from DockerServiceLive for direct testing
    function createBuffer() {
      const scrollback: string[] = []
      let scrollbackLen = 0
      return {
        append(data: string) {
          scrollback.push(data)
          scrollbackLen += data.length
          while (scrollbackLen > SCROLLBACK_BUFFER_SIZE && scrollback.length > 1) {
            scrollbackLen -= scrollback.shift()!.length
          }
        },
        get() {
          return scrollback.join('')
        },
      }
    }

    it('basic accumulation', () => {
      const buf = createBuffer()
      buf.append('hello')
      buf.append('world')
      expect(buf.get()).toBe('helloworld')
    })

    it('buffer wrapping at 100k chars', () => {
      const buf = createBuffer()
      // Feed 120k characters in chunks
      for (let i = 0; i < 12; i++) {
        buf.append('A'.repeat(10_000))
      }
      const result = buf.get()
      expect(result.length).toBeLessThanOrEqual(SCROLLBACK_BUFFER_SIZE + 10_000)
      expect(result.length).toBeGreaterThan(0)
      // Oldest data should be trimmed from the front
      expect(result[0]).toBe('A')
    })

    it('multi-chunk concatenation preserves order', () => {
      const buf = createBuffer()
      for (let i = 0; i < 50; i++) {
        buf.append(`chunk-${String(i).padStart(3, '0')}-${'x'.repeat(90)}`)
      }
      const result = buf.get()
      // Each chunk is 10 (prefix) + 90 (x's) = 100 chars. 50 * 100 = 5000
      expect(result.length).toBe(5000)
      expect(result.startsWith('chunk-000-')).toBe(true)
      expect(result.endsWith('x')).toBe(true)
    })

    it('large overflow trims oldest chunks', () => {
      const buf = createBuffer()
      // Add a small chunk first
      buf.append('FIRST')
      // Then add a chunk that exceeds the buffer
      buf.append('X'.repeat(SCROLLBACK_BUFFER_SIZE + 1))
      const result = buf.get()
      // The first chunk should have been evicted
      expect(result.startsWith('FIRST')).toBe(false)
      expect(result.startsWith('X')).toBe(true)
    })
  })
})
