import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NotificationController } from '../../domains/notification/controller'
import { PodController } from '../../domains/pod/controller'
import type { PodControllerShape } from '../../domains/pod/controller/pod'
import { WorkspaceController } from '../../domains/workspace/controller'
import { makeTestRuntime } from './test-layer'

describe('NotificationController', () => {
  let runtime: ReturnType<typeof makeTestRuntime>['runtime']

  beforeEach(() => {
    ;({ runtime } = makeTestRuntime())
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  async function createProject() {
    const projSvc = await runtime.runPromise(WorkspaceController)
    return runtime.runPromise(projSvc.create({ name: 'Test Project', cwd: '/tmp/test' }))
  }

  it('emit creates notification with correct fields', async () => {
    const svc = await runtime.runPromise(NotificationController)
    const notif = await runtime.runPromise(
      svc.emit({
        type: 'agent:permission-request',
        priority: 'blocking',
        title: 'Allow shell command?',
        body: 'rm -rf /tmp/test',
        payload: { requestId: 42, type: 'shell', command: 'rm -rf /tmp/test' },
      }),
    )

    expect(notif.id).toBeTruthy()
    expect(notif.type).toBe('agent:permission-request')
    expect(notif.priority).toBe('blocking')
    expect(notif.title).toBe('Allow shell command?')
    expect(notif.body).toBe('rm -rf /tmp/test')
    expect(notif.payload).toEqual({ requestId: 42, type: 'shell', command: 'rm -rf /tmp/test' })
    expect(notif.podId).toBeNull()
    expect(notif.workspaceId).toBeNull()
    expect(notif.createdAt).toBeInstanceOf(Date)
    expect(notif.readAt).toBeNull()
    expect(notif.resolvedAt).toBeNull()
    expect(notif.resolution).toBeNull()
  })

  it('emit auto-resolves workspaceId from podId', async () => {
    const project = await createProject()
    const podSvc: PodControllerShape = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(podSvc.create({ name: 'Test Pod', workspaceId: project.id, cwd: '/tmp' }))

    const svc = await runtime.runPromise(NotificationController)
    const notif = await runtime.runPromise(
      svc.emit({
        type: 'terminal:exit',
        priority: 'urgent',
        podId: pod.id,
        title: 'Terminal exited with code 1',
      }),
    )

    expect(notif.podId).toBe(pod.id)
    expect(notif.workspaceId).toBe(project.id)
  })

  it('resolve sets resolvedAt and resolution', async () => {
    const svc = await runtime.runPromise(NotificationController)
    const notif = await runtime.runPromise(
      svc.emit({
        type: 'agent:permission-request',
        priority: 'blocking',
        title: 'Allow?',
      }),
    )

    await runtime.runPromise(svc.resolve(notif.id, 'accepted'))

    const unresolved = await runtime.runPromise(svc.listUnresolved())
    expect(unresolved).toHaveLength(0)

    const recent = await runtime.runPromise(svc.listRecent())
    expect(recent[0]!.resolvedAt).toBeInstanceOf(Date)
    expect(recent[0]!.resolution).toBe('accepted')
  })

  it('resolveByPayload resolves matching notifications', async () => {
    const svc = await runtime.runPromise(NotificationController)
    await runtime.runPromise(
      svc.emit({
        type: 'agent:permission-request',
        priority: 'blocking',
        title: 'Allow 1?',
        payload: { requestId: 100 },
      }),
    )
    await runtime.runPromise(
      svc.emit({
        type: 'agent:permission-request',
        priority: 'blocking',
        title: 'Allow 2?',
        payload: { requestId: 200 },
      }),
    )

    const count = await runtime.runPromise(svc.resolveByPayload('requestId', 100, 'accepted'))
    expect(count).toBe(1)

    const unresolved = await runtime.runPromise(svc.listUnresolved())
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]!.title).toBe('Allow 2?')
  })

  it('resolveByPayload returns 0 when no match', async () => {
    const svc = await runtime.runPromise(NotificationController)
    await runtime.runPromise(
      svc.emit({
        type: 'agent:permission-request',
        priority: 'blocking',
        title: 'Allow?',
        payload: { requestId: 100 },
      }),
    )

    const count = await runtime.runPromise(svc.resolveByPayload('requestId', 999, 'accepted'))
    expect(count).toBe(0)
  })

  it('markRead sets readAt', async () => {
    const svc = await runtime.runPromise(NotificationController)
    const notif = await runtime.runPromise(
      svc.emit({
        type: 'workflow:run-completed',
        priority: 'info',
        title: 'Run done',
      }),
    )

    await runtime.runPromise(svc.markRead(notif.id))

    const recent = await runtime.runPromise(svc.listRecent())
    expect(recent[0]!.readAt).toBeInstanceOf(Date)
  })

  it('listUnresolved excludes resolved', async () => {
    const svc = await runtime.runPromise(NotificationController)
    const n1 = await runtime.runPromise(svc.emit({ type: 'terminal:exit', priority: 'urgent', title: 'Exit 1' }))
    await runtime.runPromise(svc.emit({ type: 'terminal:exit', priority: 'urgent', title: 'Exit 2' }))

    await runtime.runPromise(svc.resolve(n1.id, 'dismissed'))

    const unresolved = await runtime.runPromise(svc.listUnresolved())
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]!.title).toBe('Exit 2')
  })

  it('listRecent returns most recent first with limit', async () => {
    const svc = await runtime.runPromise(NotificationController)
    await runtime.runPromise(svc.emit({ type: 'workflow:run-completed', priority: 'info', title: 'First' }))
    await runtime.runPromise(svc.emit({ type: 'workflow:run-completed', priority: 'info', title: 'Second' }))
    await runtime.runPromise(svc.emit({ type: 'workflow:run-completed', priority: 'info', title: 'Third' }))

    const recent = await runtime.runPromise(svc.listRecent(2))
    expect(recent).toHaveLength(2)
    expect(recent[0]!.title).toBe('Third')
    expect(recent[1]!.title).toBe('Second')
  })

  it('unresolvedCounts groups by pod/project/global correctly', async () => {
    const project = await createProject()
    const podSvc: PodControllerShape = await runtime.runPromise(PodController)
    const pod = await runtime.runPromise(podSvc.create({ name: 'P1', workspaceId: project.id, cwd: '/tmp' }))

    const svc = await runtime.runPromise(NotificationController)

    // Pod-scoped notification
    await runtime.runPromise(svc.emit({ type: 'terminal:exit', priority: 'urgent', podId: pod.id, title: 'Pod exit' }))

    // Global notification (no podId)
    await runtime.runPromise(svc.emit({ type: 'agent:permission-request', priority: 'blocking', title: 'Global perm' }))

    const counts = await runtime.runPromise(svc.unresolvedCounts())

    expect(counts.byPod[pod.id]).toEqual({ blocking: 0, urgent: 1, info: 0 })
    expect(counts.byWorkspace[project.id]).toEqual({ blocking: 0, urgent: 1, info: 0 })
    expect(counts.global).toEqual({ blocking: 1, urgent: 0, info: 0 })
    expect(counts.totalBlocking).toBe(1)
    expect(counts.totalUrgent).toBe(1)
  })

  it('unresolvedCounts.totalBlocking counts only blocking priority', async () => {
    const svc = await runtime.runPromise(NotificationController)

    await runtime.runPromise(svc.emit({ type: 'agent:permission-request', priority: 'blocking', title: 'B1' }))
    await runtime.runPromise(svc.emit({ type: 'agent:permission-request', priority: 'blocking', title: 'B2' }))
    await runtime.runPromise(svc.emit({ type: 'terminal:exit', priority: 'urgent', title: 'U1' }))
    await runtime.runPromise(svc.emit({ type: 'workflow:run-completed', priority: 'info', title: 'I1' }))

    const counts = await runtime.runPromise(svc.unresolvedCounts())
    expect(counts.totalBlocking).toBe(2)
    expect(counts.totalUrgent).toBe(1)
  })
})
