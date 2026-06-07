import os from 'node:os'
import { type Duplex, Readable } from 'node:stream'
import Docker from 'dockerode'
import { Context, Effect, Layer } from 'effect'
import { v4 as uuid } from 'uuid'
import { LABEL_PREFIX } from '../app-config'
import { log } from '../packages/logger'
import { HeadlessScrollback } from '../packages/pty/headless-scrollback'
import type { SnapshotStore } from '../packages/pty/snapshot-store'
import { AppError } from './errors'

// --- Errors ---

/** A Docker daemon operation failed. Carries the operation name for diagnostics. Maps to HTTP 500. */
export class DockerError extends AppError('DockerError', 'INTERNAL_SERVER_ERROR')<{
  readonly operation: string
}> {}

const dockerError = (operation: string) => (cause: unknown) =>
  new DockerError({ operation, message: `docker ${operation} failed: ${String(cause)}`, cause })

// --- Types ---

export interface ContainerCreateOpts {
  image: string
  name?: string
  env?: Record<string, string>
  workDir?: string
  mounts?: Array<{ source: string; target: string; readonly?: boolean }>
  resources?: { memory?: number; cpus?: number }
  labels?: Record<string, string>
  ports?: Array<{ containerPort: number; protocol?: 'tcp' | 'udp' }>
}

export interface DockerExecOpts {
  containerId: string
  cmd: string[]
  env?: Record<string, string>
  workDir?: string
  user?: string
  cols?: number
  rows?: number
}

export interface ContainerInfo {
  id: string
  name: string
  image: string
  state: 'created' | 'running' | 'paused' | 'exited' | 'dead'
  labels: Record<string, string>
  ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null>
  created?: number
}

/** Type guard for errors with a numeric statusCode (e.g. dockerode HTTP errors). */
function hasStatusCode(err: unknown): err is { statusCode: number } {
  return (
    err != null &&
    typeof err === 'object' &&
    'statusCode' in err &&
    typeof (err as Record<string, unknown>).statusCode === 'number'
  )
}

const VALID_CONTAINER_STATES = new Set<ContainerInfo['state']>(['created', 'running', 'paused', 'exited', 'dead'])

/** Narrow a Docker state string to the known ContainerInfo state union, defaulting to 'exited'. */
function toContainerState(state: string | undefined): ContainerInfo['state'] {
  return VALID_CONTAINER_STATES.has(state as ContainerInfo['state']) ? (state as ContainerInfo['state']) : 'exited'
}

export interface ImageInfo {
  id: string
  tags: string[]
  size: number
  created: number
}

export interface PullProgress {
  status: string
  id?: string
  progress?: number
  current?: number
  total?: number
}

export interface ContainerStats {
  cpuPercent: number
  memoryUsage: number
  memoryLimit: number
}

export interface BuildProgress {
  stream?: string
  error?: string
  status: 'building' | 'success' | 'failed'
}

interface ExecStreamInstance {
  id: string
  exec: Docker.Exec
  stream: Duplex
  headless: HeadlessScrollback
  cols: number
  rows: number
  dataCallbacks: Set<(data: string) => void>
  exitCallbacks: Set<(code: number) => void>
}

// --- Service interface ---

export interface DockerServiceShape {
  readonly createContainer: (opts: ContainerCreateOpts) => Effect.Effect<string, DockerError>
  readonly startContainer: (id: string) => Effect.Effect<void, DockerError>
  readonly stopContainer: (id: string, timeout?: number) => Effect.Effect<void, DockerError>
  readonly removeContainer: (id: string, force?: boolean) => Effect.Effect<void, DockerError>
  readonly listContainers: (all?: boolean) => Effect.Effect<ContainerInfo[], DockerError>

  readonly exec: (opts: DockerExecOpts) => Effect.Effect<string, DockerError>

  // Hot-path methods (no Effect)
  readonly execWrite: (streamId: string, data: string) => void
  readonly execResize: (streamId: string, cols: number, rows: number) => void
  readonly getExecScrollback: (streamId: string) => string
  readonly clearExecScrollback: (streamId: string) => void
  readonly destroyExecStream: (streamId: string) => void
  readonly destroyAllExecStreams: () => void

  readonly removeImage: (id: string, force?: boolean) => Effect.Effect<void, DockerError>

  readonly pullImage: (image: string) => AsyncGenerator<PullProgress>
  readonly buildImage: (dockerfile: string, tag: string, opts?: { nocache?: boolean }) => AsyncGenerator<BuildProgress>
  readonly listImages: () => Effect.Effect<ImageInfo[], DockerError>

  readonly inspectContainer: (id: string) => Effect.Effect<ContainerInfo | null, DockerError>

  readonly containerStats: (containerIds: string[]) => Effect.Effect<Record<string, ContainerStats>, DockerError>
  readonly checkDockerAvailable: () => Effect.Effect<boolean>
  readonly cleanupOrphanContainers: () => Effect.Effect<number, DockerError>

  readonly onExecData: (streamId: string, cb: (data: string) => void) => () => void
  readonly onExecExit: (streamId: string, cb: (code: number) => void) => () => void

  readonly commitContainer: (id: string, repo: string, tag: string) => Effect.Effect<string, DockerError>

  // Global exec stream listeners (for daemon forwarding)
  readonly onAnyExecData: (cb: (streamId: string, data: string) => void) => () => void
  readonly onAnyExecExit: (cb: (streamId: string, code: number) => void) => () => void

  // Scrollback persistence
  readonly setSnapshotStore: (store: SnapshotStore) => void
  readonly flushAllScrollback: () => void
}

export class DockerService extends Context.Tag('DockerService')<DockerService, DockerServiceShape>() {}

const FLUSH_THRESHOLD = 50_000

export const DockerServiceLive = Layer.sync(DockerService, () => {
  const docker = new Docker()
  const execStreams = new Map<string, ExecStreamInstance>()
  const anyExecDataCbs = new Set<(streamId: string, data: string) => void>()
  const anyExecExitCbs = new Set<(streamId: string, code: number) => void>()
  let snapshotStore: SnapshotStore | null = null
  const dirtyStreams = new Set<string>()
  const bytesSinceFlush = new Map<string, number>()

  function trackDirty(id: string, bytes: number) {
    if (!snapshotStore) return
    dirtyStreams.add(id)
    const accumulated = (bytesSinceFlush.get(id) ?? 0) + bytes
    bytesSinceFlush.set(id, accumulated)
    if (accumulated >= FLUSH_THRESHOLD) {
      flushOne(id)
    }
  }

  function flushOne(id: string) {
    if (!snapshotStore) return
    const instance = execStreams.get(id)
    if (!instance) return
    snapshotStore.writeSnapshot(id, instance.headless.serialize(), {
      cols: instance.cols,
      rows: instance.rows,
      timestamp: Date.now(),
      rawlogOffset: snapshotStore.getRawLogOffset(id),
    })
    dirtyStreams.delete(id)
    bytesSinceFlush.set(id, 0)
  }

  function envToArray(env?: Record<string, string>): string[] | undefined {
    if (!env) return undefined
    return Object.entries(env).map(([k, v]) => `${k}=${v}`)
  }

  return {
    createContainer: (opts) =>
      Effect.tryPromise({
        catch: dockerError('createContainer'),
        try: async () => {
          const ExposedPorts: Record<string, object> = {}
          const PortBindings: Record<string, Array<{ HostIp: string; HostPort: string }>> = {}
          if (opts.ports) {
            for (const p of opts.ports) {
              const key = `${p.containerPort}/${p.protocol ?? 'tcp'}`
              ExposedPorts[key] = {}
              PortBindings[key] = [{ HostIp: '127.0.0.1', HostPort: '' }]
            }
          }
          const hasPorts = Object.keys(ExposedPorts).length > 0

          const createOpts: Docker.ContainerCreateOptions = {
            Image: opts.image,
            name: opts.name,
            Env: envToArray(opts.env),
            WorkingDir: opts.workDir,
            Labels: opts.labels,
            Tty: true,
            OpenStdin: true,
            ExposedPorts: hasPorts ? ExposedPorts : undefined,
            HostConfig: {
              Binds: opts.mounts?.map((m) => {
                const source = m.source.startsWith('~') ? m.source.replace('~', os.homedir()) : m.source
                return `${source}:${m.target}${m.readonly ? ':ro' : ''}`
              }),
              Memory: opts.resources?.memory,
              NanoCpus: opts.resources?.cpus ? opts.resources.cpus * 1e9 : undefined,
              PortBindings: hasPorts ? PortBindings : undefined,
            },
          }

          try {
            const container = await docker.createContainer(createOpts)
            return container.id
          } catch (err: unknown) {
            // Auto-pull image if not found locally
            if (hasStatusCode(err) && err.statusCode === 404) {
              log.docker.info(`Image "${opts.image}" not found locally, pulling...`)
              const stream: NodeJS.ReadableStream = await docker.pull(opts.image)
              await new Promise<void>((resolve, reject) => {
                docker.modem.followProgress(stream, (pullErr: Error | null) => {
                  if (pullErr) reject(pullErr)
                  else resolve()
                })
              })
              log.docker.info(`Image "${opts.image}" pulled successfully`)
              const container = await docker.createContainer(createOpts)
              return container.id
            }
            throw err
          }
        },
      }),

    startContainer: (id) =>
      Effect.tryPromise({
        catch: dockerError('startContainer'),
        try: async () => {
          const container = docker.getContainer(id)
          await container.start()
        },
      }),

    stopContainer: (id, timeout) =>
      Effect.tryPromise({
        catch: dockerError('stopContainer'),
        try: async () => {
          const container = docker.getContainer(id)
          try {
            await container.stop({ t: timeout ?? 10 })
          } catch (err: unknown) {
            // 304 = container already stopped — not an error
            if (hasStatusCode(err) && err.statusCode === 304) return
            throw err
          }
        },
      }),

    removeContainer: (id, force) =>
      Effect.tryPromise({
        catch: dockerError('removeContainer'),
        try: async () => {
          const container = docker.getContainer(id)
          await container.remove({ force: force ?? false })
        },
      }),

    listContainers: (all) =>
      Effect.tryPromise({
        catch: dockerError('listContainers'),
        try: async () => {
          const containers = await docker.listContainers({ all: all ?? false })
          return containers.map((c) => ({
            id: c.Id,
            name: (c.Names[0] ?? '').replace(/^\//, ''),
            image: c.Image,
            state: toContainerState(c.State),
            labels: c.Labels,
            created: c.Created,
          }))
        },
      }),

    inspectContainer: (id) =>
      Effect.tryPromise({
        catch: dockerError('inspectContainer'),
        try: async () => {
          try {
            const info = await docker.getContainer(id).inspect()
            return {
              id: info.Id,
              name: (info.Name ?? '').replace(/^\//, ''),
              image: info.Config?.Image ?? '',
              state: toContainerState(info.State?.Status),
              labels: info.Config?.Labels ?? {},
              ports: info.NetworkSettings?.Ports ?? undefined,
            }
          } catch (err: unknown) {
            if (hasStatusCode(err) && err.statusCode === 404) return null
            throw err
          }
        },
      }),

    exec: (opts) =>
      Effect.tryPromise({
        catch: dockerError('exec'),
        try: async () => {
          const streamId = uuid()
          const container = docker.getContainer(opts.containerId)

          const exec = await container.exec({
            Cmd: opts.cmd,
            Env: envToArray(opts.env),
            WorkingDir: opts.workDir,
            User: opts.user,
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true,
            Tty: true,
            ConsoleSize: opts.rows && opts.cols ? [opts.rows, opts.cols] : undefined,
          })
          const stream = await exec.start({ hijack: true, stdin: true, Tty: true })

          const instance: ExecStreamInstance = {
            id: streamId,
            exec,
            stream,
            headless: new HeadlessScrollback({ cols: opts.cols, rows: opts.rows }),
            cols: opts.cols ?? 80,
            rows: opts.rows ?? 30,
            dataCallbacks: new Set(),
            exitCallbacks: new Set(),
          }

          stream.on('data', (chunk: Buffer) => {
            const data = chunk.toString()
            instance.headless.write(data)
            snapshotStore?.appendRawLog(streamId, data)
            trackDirty(streamId, data.length)
            for (const cb of instance.dataCallbacks) cb(data)
            for (const cb of anyExecDataCbs) cb(streamId, data)
          })

          stream.on('error', (err) => {
            log.docker.error(`exec stream error for ${streamId}:`, err)
            for (const cb of instance.exitCallbacks) cb(1)
            for (const cb of anyExecExitCbs) cb(streamId, 1)
            execStreams.delete(streamId)
          })

          stream.on('end', async () => {
            let exitCode: number
            try {
              const info = await exec.inspect()
              exitCode = info.ExitCode ?? 0
            } catch {
              exitCode = 1
            }
            for (const cb of instance.exitCallbacks) cb(exitCode)
            for (const cb of anyExecExitCbs) cb(streamId, exitCode)
          })

          execStreams.set(streamId, instance)
          return streamId
        },
      }),

    execWrite: (streamId, data) => {
      execStreams.get(streamId)?.stream.write(data)
    },

    execResize: (streamId, cols, rows) => {
      const instance = execStreams.get(streamId)
      if (instance) {
        instance.cols = cols
        instance.rows = rows
        instance.headless.resize(cols, rows)
        instance.exec.resize({ h: rows, w: cols }).catch((err: unknown) => {
          log.docker.error(`exec resize failed for ${streamId}:`, err)
        })
      }
    },

    getExecScrollback: (streamId) => {
      const instance = execStreams.get(streamId)
      if (instance) return instance.headless.serialize()

      // Instance gone — try snapshot restore
      if (snapshotStore) {
        const snap = snapshotStore.readSnapshot(streamId)
        if (snap) {
          const headless = new HeadlessScrollback({ cols: snap.meta.cols, rows: snap.meta.rows })
          headless.write(snap.serialized)
          const gap = snapshotStore.readRawLogFrom(streamId, 0)
          if (gap) headless.write(gap)
          const result = headless.serialize()
          headless.dispose()
          return result
        }
        return snapshotStore.readLegacy(streamId)
      }
      return ''
    },

    clearExecScrollback: (streamId) => {
      const instance = execStreams.get(streamId)
      if (instance) {
        instance.headless.dispose()
        instance.headless = new HeadlessScrollback({ cols: instance.cols, rows: instance.rows })
      }
      dirtyStreams.delete(streamId)
      bytesSinceFlush.delete(streamId)
      snapshotStore?.delete(streamId)
    },

    destroyExecStream: (streamId) => {
      const instance = execStreams.get(streamId)
      if (!instance) return
      instance.stream.destroy()
      instance.headless.dispose()
      instance.dataCallbacks.clear()
      instance.exitCallbacks.clear()
      execStreams.delete(streamId)
      dirtyStreams.delete(streamId)
      bytesSinceFlush.delete(streamId)
      snapshotStore?.delete(streamId)
    },

    destroyAllExecStreams: () => {
      for (const instance of execStreams.values()) {
        instance.stream.destroy()
        instance.headless.dispose()
        instance.dataCallbacks.clear()
        instance.exitCallbacks.clear()
      }
      execStreams.clear()
    },

    pullImage: async function* (image) {
      const pullStream: NodeJS.ReadableStream = await docker.pull(image)

      yield* {
        async *[Symbol.asyncIterator]() {
          for await (const chunk of pullStream) {
            const lines = chunk.toString().split('\n').filter(Boolean)
            for (const line of lines) {
              try {
                const event = JSON.parse(line)
                const progress: PullProgress = {
                  status: event.status ?? '',
                  id: event.id,
                }
                if (event.progressDetail?.current != null && event.progressDetail?.total != null) {
                  progress.current = event.progressDetail.current
                  progress.total = event.progressDetail.total
                  progress.progress = event.progressDetail.current / event.progressDetail.total
                }
                yield progress
              } catch {
                // skip malformed JSON lines
              }
            }
          }
        },
      }
    },

    buildImage: async function* (dockerfile, tag, opts) {
      // Create minimal tar archive with just the Dockerfile
      const content = Buffer.from(dockerfile, 'utf-8')
      const header = Buffer.alloc(512)

      // tar header: name (0-99), mode (100-107), size (124-135), magic (257-262), version (263-264)
      header.write('Dockerfile', 0)
      header.write('0000644\0', 100)
      header.write('0000000\0', 108) // uid
      header.write('0000000\0', 116) // gid
      header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124) // size
      header.write('0000000\0', 136) // mtime
      header.write('ustar\0', 257) // magic
      header.write('00', 263) // version

      // Calculate checksum
      header.write('        ', 148) // blank checksum field
      let checksum = 0
      for (let i = 0; i < 512; i++) checksum += header[i] ?? 0
      header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148)

      // Pad content to 512-byte boundary
      const padding = Buffer.alloc(512 - (content.length % 512 || 512))
      const endMarker = Buffer.alloc(1024) // two 512-byte zero blocks
      const tarBuffer = Buffer.concat([header, content, padding, endMarker])

      const buildStream = await docker.buildImage(Readable.from(tarBuffer), { t: tag, nocache: opts?.nocache })

      yield* {
        async *[Symbol.asyncIterator]() {
          for await (const chunk of buildStream) {
            const lines = chunk.toString().split('\n').filter(Boolean)
            for (const line of lines) {
              try {
                const event = JSON.parse(line)
                if (event.error) {
                  yield { error: event.error, status: 'failed' as const }
                  return
                }
                if (event.stream) {
                  yield { stream: event.stream, status: 'building' as const }
                }
              } catch {
                // skip malformed JSON
              }
            }
          }
          yield { status: 'success' as const }
        },
      }
    },

    listImages: () =>
      Effect.tryPromise({
        catch: dockerError('listImages'),
        try: async () => {
          const images = await docker.listImages()
          return images.map((img) => ({
            id: img.Id,
            tags: img.RepoTags ?? [],
            size: img.Size,
            created: img.Created,
          }))
        },
      }),

    removeImage: (id, force) =>
      Effect.tryPromise({
        catch: dockerError('removeImage'),
        try: async () => {
          await docker.getImage(id).remove({ force: force ?? false })
        },
      }),

    containerStats: (containerIds) =>
      Effect.tryPromise({
        catch: dockerError('containerStats'),
        try: async () => {
          const results: Record<string, ContainerStats> = {}
          const settled = await Promise.allSettled(
            containerIds.map(async (id) => {
              const container = docker.getContainer(id)
              const stats = await container.stats({ stream: false })
              // Docker CPU delta formula
              const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage
              const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage
              const numCpus = stats.cpu_stats.online_cpus ?? stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1
              const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0
              results[id] = {
                cpuPercent: Math.round(cpuPercent * 10) / 10,
                memoryUsage: stats.memory_stats.usage ?? 0,
                memoryLimit: stats.memory_stats.limit ?? 0,
              }
            }),
          )
          // Only include successful results (failed containers silently omitted)
          for (const [i, outcome] of settled.entries()) {
            const id = containerIds[i]
            if (id !== undefined && outcome.status === 'rejected') {
              delete results[id]
            }
          }
          return results
        },
      }),

    checkDockerAvailable: () =>
      Effect.promise(async () => {
        try {
          await docker.ping()
          return true
        } catch {
          return false
        }
      }),

    cleanupOrphanContainers: () =>
      Effect.tryPromise({
        catch: dockerError('cleanupOrphanContainers'),
        try: async () => {
          const containers = await docker.listContainers({
            all: true,
            filters: { label: [`${LABEL_PREFIX}.pod`] },
          })
          let cleaned = 0
          for (const info of containers) {
            const container = docker.getContainer(info.Id)
            try {
              if (info.State === 'running') {
                await container.stop({ t: 2 })
              }
              await container.remove({ force: true })
              cleaned++
            } catch {
              // container may have been removed between list and remove
            }
          }
          return cleaned
        },
      }),

    commitContainer: (id, repo, tag) =>
      Effect.tryPromise({
        catch: dockerError('commitContainer'),
        try: async () => {
          const container = docker.getContainer(id)
          const result = await container.commit({ repo, tag })
          return String(result.Id)
        },
      }),

    onExecData: (streamId, cb) => {
      const instance = execStreams.get(streamId)
      if (!instance) return () => {}
      instance.dataCallbacks.add(cb)
      return () => {
        instance.dataCallbacks.delete(cb)
      }
    },

    onExecExit: (streamId, cb) => {
      const instance = execStreams.get(streamId)
      if (!instance) return () => {}
      instance.exitCallbacks.add(cb)
      return () => {
        instance.exitCallbacks.delete(cb)
      }
    },

    onAnyExecData: (cb) => {
      anyExecDataCbs.add(cb)
      return () => {
        anyExecDataCbs.delete(cb)
      }
    },

    onAnyExecExit: (cb) => {
      anyExecExitCbs.add(cb)
      return () => {
        anyExecExitCbs.delete(cb)
      }
    },

    setSnapshotStore: (store) => {
      snapshotStore = store
    },

    flushAllScrollback: () => {
      if (!snapshotStore) return
      for (const id of dirtyStreams) {
        flushOne(id)
      }
      dirtyStreams.clear()
      bytesSinceFlush.clear()
    },
  }
})
