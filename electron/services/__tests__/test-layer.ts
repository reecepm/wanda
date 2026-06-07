import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { v4 as uuid } from 'uuid'
import { runMigrations } from '../../db/migrate'
import * as schema from '../../db/schema'
import * as taskSchema from '../../db/task-schema'
import { DatabaseService } from '../../infra/database'
import { configureSecretStore, createAesSecretStore } from '../../infra/secret-store'
import type { PtyConfig } from '../../packages/pty/types'

// Configure a per-module secret store so target tests (which exercise
// the encryption path in targets/repository/targets.ts) can encrypt/
// decrypt without the shell's file-backed key. Uses a random AES-256
// key — test data never leaves the process so the key doesn't need to
// be persistent.
configureSecretStore(createAesSecretStore(randomBytes(32)))

import { GitControllerLive } from '../../domains/git/controller'
import { NotificationControllerLive } from '../../domains/notification/controller'
import {
  PodContainerControllerLive,
  PodControllerLive,
  PodCrudControllerLive,
  PodItemControllerLive,
  PodLifecycleControllerLive,
} from '../../domains/pod/controller'
import { AgentConfigControllerLive, SettingsControllerLive } from '../../domains/settings/controller'
import { ViewControllerLive } from '../../domains/view/controller'
import {
  BootstrapRunnerLive,
  WorkenvControllerLive,
  WorkenvEventsLive,
  WorkenvExecLive,
  WorkenvHealthLive,
  WorkenvTemplatesLive,
} from '../../domains/workenv'
import {
  WorkspaceController,
  WorkspaceControllerLive,
  WorkspaceSettingsControllerLive,
} from '../../domains/workspace/controller'
import { Broadcaster } from '../../infra/broadcaster'
import { AgentStatusServiceLive } from '../../packages/agent-hooks'
import {
  type BuildProgress,
  type ContainerCreateOpts,
  type ContainerInfo,
  type DockerExecOpts,
  DockerService,
  type DockerServiceShape,
  type ImageInfo,
  type PullProgress,
} from '../docker.service'
import { PtyService, type PtyServiceShape } from '../pty.service'
import { makeRuntimeRegistryLive } from '../runtime-registry.service'

const workenvLayers = {
  BootstrapRunnerLive,
  WorkenvControllerLive,
  WorkenvEventsLive,
  WorkenvExecLive,
  WorkenvHealthLive,
  WorkenvTemplatesLive,
  makeRuntimeRegistryLive,
}

/** In-memory SQLite database layer for testing */
function makeTestDatabaseLayer() {
  return Layer.sync(DatabaseService, () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema: { ...schema, ...taskSchema } })
    runMigrations(db, join(__dirname, '../../db/migrations'))
    return db
  })
}

export interface MockPtyTracker {
  created: { id: string; config: PtyConfig }[]
  destroyed: string[]
  writes: { id: string; data: string }[]
  scrollbackData: Map<string, string>
  exitCallbacks: Map<string, (id: string, exitCode: number) => void>
  triggerExit: (ptyId: string, exitCode: number) => void
  anyDataCallbacks: Set<(id: string, data: string) => void>
  anyExitCallbacks: Set<(id: string, code: number) => void>
  triggerAnyData: (id: string, data: string) => void
  triggerAnyExit: (id: string, code: number) => void
}

/** Mock PtyService that tracks calls without spawning real processes */
export function makeTestPtyLayer(): { layer: Layer.Layer<PtyService>; tracker: MockPtyTracker } {
  const tracker: MockPtyTracker = {
    created: [],
    destroyed: [],
    writes: [],
    scrollbackData: new Map(),
    exitCallbacks: new Map(),
    triggerExit(ptyId, exitCode) {
      const cb = this.exitCallbacks.get(ptyId)
      if (cb) cb(ptyId, exitCode)
    },
    anyDataCallbacks: new Set(),
    anyExitCallbacks: new Set(),
    triggerAnyData(id, data) {
      for (const cb of this.anyDataCallbacks) cb(id, data)
    },
    triggerAnyExit(id, code) {
      for (const cb of this.anyExitCallbacks) cb(id, code)
    },
  }

  const layer = Layer.sync(
    PtyService,
    (): PtyServiceShape => ({
      create: (config) =>
        Effect.sync(() => {
          const id = uuid()
          tracker.created.push({ id, config })
          if (config.onExit) {
            tracker.exitCallbacks.set(id, config.onExit)
          }
          return id
        }),
      destroy: (id) =>
        Effect.sync(() => {
          tracker.destroyed.push(id)
          tracker.exitCallbacks.delete(id)
        }),
      restart: (id) =>
        Effect.sync(() => {
          tracker.destroyed.push(id)
          const newId = uuid()
          tracker.created.push({ id: newId, config: { cwd: '' } })
        }),
      list: () => Effect.sync(() => []),
      write: (id, data) => {
        tracker.writes.push({ id, data })
      },
      resize: () => {},
      getScrollback: (id) => tracker.scrollbackData.get(id) ?? '',
      destroyAll: () => {},
      onAnyData: (cb) => {
        tracker.anyDataCallbacks.add(cb)
        return () => {
          tracker.anyDataCallbacks.delete(cb)
        }
      },
      onAnyExit: (cb) => {
        tracker.anyExitCallbacks.add(cb)
        return () => {
          tracker.anyExitCallbacks.delete(cb)
        }
      },
      getScrollbackAsync: (id) => Promise.resolve(tracker.scrollbackData.get(id) ?? ''),
      clear: () => {},
      subscribe: () => {},
      unsubscribe: () => {},
      ack: () => {},
      configure: () => {},
      engine: null as never,
      ready: Promise.resolve(),
    }),
  )

  return { layer, tracker }
}

export interface MockDockerTracker {
  containersCreated: { id: string; opts: ContainerCreateOpts }[]
  containersStarted: string[]
  containersStopped: { id: string; timeout?: number }[]
  containersRemoved: { id: string; force?: boolean }[]
  execsCreated: { streamId: string; opts: DockerExecOpts }[]
  execWrites: { streamId: string; data: string }[]
  execResizes: { streamId: string; cols: number; rows: number }[]
  execsDestroyed: string[]
  execScrollbackData: Map<string, string>
  imagesPulled: string[]
  pullProgress: PullProgress[]
  imagesBuilt: { dockerfile: string; tag: string }[]
  buildProgress: BuildProgress[]
  dataCallbacks: Map<string, Set<(data: string) => void>>
  exitCallbacks: Map<string, Set<(code: number) => void>>
  triggerExecData: (streamId: string, data: string) => void
  triggerExecExit: (streamId: string, code: number) => void
  anyExecDataCallbacks: Set<(streamId: string, data: string) => void>
  anyExecExitCallbacks: Set<(streamId: string, code: number) => void>
  triggerAnyExecData: (streamId: string, data: string) => void
  triggerAnyExecExit: (streamId: string, code: number) => void
  dockerAvailable: boolean
  orphanCount: number
  preseededContainers: ContainerInfo[]
  inspectResults: Map<string, ContainerInfo | null>
}

/** Mock DockerService that tracks calls without real Docker */
export function makeTestDockerLayer(): { layer: Layer.Layer<DockerService>; tracker: MockDockerTracker } {
  const tracker: MockDockerTracker = {
    containersCreated: [],
    containersStarted: [],
    containersStopped: [],
    containersRemoved: [],
    execsCreated: [],
    execWrites: [],
    execResizes: [],
    execsDestroyed: [],
    execScrollbackData: new Map(),
    imagesPulled: [],
    pullProgress: [{ status: 'Pulling from library/alpine' }, { status: 'Pull complete' }],
    imagesBuilt: [],
    buildProgress: [{ status: 'building', stream: 'Step 1/1' }, { status: 'success' }],
    dataCallbacks: new Map(),
    exitCallbacks: new Map(),
    triggerExecData(streamId, data) {
      const cbs = this.dataCallbacks.get(streamId)
      if (cbs) for (const cb of cbs) cb(data)
    },
    triggerExecExit(streamId, code) {
      const cbs = this.exitCallbacks.get(streamId)
      if (cbs) for (const cb of cbs) cb(code)
    },
    anyExecDataCallbacks: new Set(),
    anyExecExitCallbacks: new Set(),
    triggerAnyExecData(streamId, data) {
      for (const cb of this.anyExecDataCallbacks) cb(streamId, data)
    },
    triggerAnyExecExit(streamId, code) {
      for (const cb of this.anyExecExitCallbacks) cb(streamId, code)
    },
    dockerAvailable: true,
    orphanCount: 0,
    preseededContainers: [],
    inspectResults: new Map(),
  }

  const layer = Layer.sync(
    DockerService,
    (): DockerServiceShape => ({
      createContainer: (opts) =>
        Effect.sync(() => {
          const id = uuid()
          tracker.containersCreated.push({ id, opts })
          return id
        }),
      startContainer: (id) =>
        Effect.sync(() => {
          tracker.containersStarted.push(id)
        }),
      stopContainer: (id, timeout) =>
        Effect.sync(() => {
          tracker.containersStopped.push({ id, timeout })
        }),
      removeContainer: (id, force) =>
        Effect.sync(() => {
          tracker.containersRemoved.push({ id, force })
        }),
      inspectContainer: (id) => Effect.sync(() => tracker.inspectResults.get(id) ?? null),
      listContainers: () => Effect.sync((): ContainerInfo[] => tracker.preseededContainers),
      exec: (opts) =>
        Effect.sync(() => {
          const streamId = uuid()
          tracker.execsCreated.push({ streamId, opts })
          tracker.dataCallbacks.set(streamId, new Set())
          tracker.exitCallbacks.set(streamId, new Set())
          return streamId
        }),
      execWrite: (streamId, data) => {
        tracker.execWrites.push({ streamId, data })
      },
      execResize: (streamId, cols, rows) => {
        tracker.execResizes.push({ streamId, cols, rows })
      },
      getExecScrollback: (streamId) => tracker.execScrollbackData.get(streamId) ?? '',
      clearExecScrollback: () => {},
      destroyExecStream: (streamId) => {
        tracker.execsDestroyed.push(streamId)
        tracker.dataCallbacks.delete(streamId)
        tracker.exitCallbacks.delete(streamId)
      },
      destroyAllExecStreams: () => {
        tracker.execsDestroyed.push('__all__')
        tracker.dataCallbacks.clear()
        tracker.exitCallbacks.clear()
      },
      pullImage: async function* (image) {
        tracker.imagesPulled.push(image)
        for (const p of tracker.pullProgress) yield p
      },
      buildImage: async function* (dockerfile, tag) {
        tracker.imagesBuilt.push({ dockerfile, tag })
        for (const p of tracker.buildProgress) yield p
      },
      removeImage: () => Effect.void,
      commitContainer: (_id, _repo, _tag) => Effect.sync(() => 'sha256:committed'),
      listImages: () => Effect.sync((): ImageInfo[] => []),
      checkDockerAvailable: () => Effect.sync(() => tracker.dockerAvailable),
      cleanupOrphanContainers: () =>
        Effect.sync(() => {
          let cleaned = 0
          for (const container of tracker.preseededContainers) {
            if (container.state === 'running') {
              tracker.containersStopped.push({ id: container.id, timeout: 2 })
            }
            tracker.containersRemoved.push({ id: container.id, force: true })
            cleaned++
          }
          return cleaned
        }),
      onExecData: (streamId, cb) => {
        let cbs = tracker.dataCallbacks.get(streamId)
        if (!cbs) {
          cbs = new Set()
          tracker.dataCallbacks.set(streamId, cbs)
        }
        cbs.add(cb)
        return () => {
          cbs.delete(cb)
        }
      },
      onExecExit: (streamId, cb) => {
        let cbs = tracker.exitCallbacks.get(streamId)
        if (!cbs) {
          cbs = new Set()
          tracker.exitCallbacks.set(streamId, cbs)
        }
        cbs.add(cb)
        return () => {
          cbs.delete(cb)
        }
      },
      onAnyExecData: (cb) => {
        tracker.anyExecDataCallbacks.add(cb)
        return () => {
          tracker.anyExecDataCallbacks.delete(cb)
        }
      },
      onAnyExecExit: (cb) => {
        tracker.anyExecExitCallbacks.add(cb)
        return () => {
          tracker.anyExecExitCallbacks.delete(cb)
        }
      },
      setSnapshotStore: () => {},
      containerStats: () => Effect.sync(() => ({})),
      flushAllScrollback: () => {},
    }),
  )

  return { layer, tracker }
}

// ---------------------------------------------------------------------------
// Data factories — reduce boilerplate in service tests
// ---------------------------------------------------------------------------

type TestRuntime = ReturnType<typeof makeTestRuntime>['runtime']

/** Create a workspace and return it */
export async function createTestWorkspace(runtime: TestRuntime, name = 'Test Project') {
  const svc = await runtime.runPromise(WorkspaceController)
  return runtime.runPromise(svc.create({ name, cwd: '/tmp/test' }))
}

// ---------------------------------------------------------------------------
// Test runtime
// ---------------------------------------------------------------------------

/** Create a full test runtime with in-memory DB, mock PTY, and mock Docker */
export function makeTestRuntime() {
  const testDb = makeTestDatabaseLayer()
  const { layer: testPty, tracker: ptyTracker } = makeTestPtyLayer()
  const { layer: testDocker, tracker: dockerTracker } = makeTestDockerLayer()
  const testBroadcaster = Layer.sync(Broadcaster, () => ({
    send: () => {},
  }))
  const baseLive = Layer.mergeAll(testDb, testPty, testDocker, testBroadcaster, AgentStatusServiceLive)

  const coreServices = Layer.mergeAll(
    WorkspaceControllerLive,
    SettingsControllerLive,
    AgentConfigControllerLive,
    PodItemControllerLive,
    ViewControllerLive,
    WorkspaceSettingsControllerLive,
    GitControllerLive,
    NotificationControllerLive,
  ).pipe(Layer.provideMerge(baseLive))

  // Workenv foundation (events + registry + exec) — pods need WorkenvExec
  // for workenv-attached terminal routing. Use an empty fake-adapter
  // registry so PodController boots even when tests don't exercise the
  // workenv path. Pod controller pulls WorkenvController to drive
  // auto-start of attached VMs before exec'ing terminals, so the full
  // workenv stack lives below the pod layer here.
  const workenvFoundation = Layer.mergeAll(
    workenvLayers.WorkenvEventsLive,
    workenvLayers.makeRuntimeRegistryLive({ adapters: [] }),
  ).pipe(Layer.provideMerge(coreServices))
  const workenvWithExec = workenvLayers.WorkenvExecLive.pipe(Layer.provideMerge(workenvFoundation))
  const withBootstrap = workenvLayers.BootstrapRunnerLive.pipe(Layer.provideMerge(workenvWithExec))
  const withHealth = workenvLayers.WorkenvHealthLive.pipe(Layer.provideMerge(withBootstrap))
  const withTemplates = workenvLayers.WorkenvTemplatesLive.pipe(Layer.provideMerge(withHealth))
  const withWorkenv = workenvLayers.WorkenvControllerLive.pipe(Layer.provideMerge(withTemplates))

  const withPodSupport = Layer.mergeAll(
    PodCrudControllerLive,
    PodLifecycleControllerLive,
    PodContainerControllerLive,
  ).pipe(Layer.provideMerge(withWorkenv))
  const testLayer = PodControllerLive.pipe(Layer.provideMerge(withPodSupport))

  const runtime = ManagedRuntime.make(testLayer)

  return { runtime, tracker: ptyTracker, dockerTracker }
}
