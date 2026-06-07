import { spawn } from 'node:child_process'
import { statfs } from 'node:fs/promises'
import os from 'node:os'
import { Effect } from 'effect'
import type { DockerServiceShape } from '../services/docker.service'
import type { PtyServiceShape } from '../services/pty.service'
import type {
  BuildProgress,
  ContainerCreateOpts,
  ContainerInfo,
  DockerExecOpts,
  ImageInfo,
  PtyConfig,
  PullProgress,
  ResourceInfo,
  Target,
  TargetStatus,
} from './target'

export class LocalTarget implements Target {
  readonly type = 'local' as const
  private _status: TargetStatus = 'connected'

  private streamDataCallbacks = new Map<string, Set<(data: string) => void>>()
  private streamExitCallbacks = new Map<string, Set<(code: number) => void>>()

  private execStreamIds = new Set<string>()
  private unsubPtyData: (() => void) | null = null
  private unsubPtyExit: (() => void) | null = null
  private unsubExecData: (() => void) | null = null
  private unsubExecExit: (() => void) | null = null

  readonly id: string
  readonly name: string
  private readonly ptyService: PtyServiceShape
  private readonly dockerService: DockerServiceShape

  constructor(id: string, name: string, ptyService: PtyServiceShape, dockerService: DockerServiceShape) {
    this.id = id
    this.name = name
    this.ptyService = ptyService
    this.dockerService = dockerService
    this.unsubPtyData = ptyService.onAnyData((streamId, data) => {
      const cbs = this.streamDataCallbacks.get(streamId)
      if (cbs) for (const cb of cbs) cb(data)
    })

    this.unsubPtyExit = ptyService.onAnyExit((streamId, code) => {
      const cbs = this.streamExitCallbacks.get(streamId)
      if (cbs) for (const cb of cbs) cb(code)
    })

    this.unsubExecData = dockerService.onAnyExecData((streamId, data) => {
      const cbs = this.streamDataCallbacks.get(streamId)
      if (cbs) for (const cb of cbs) cb(data)
    })

    this.unsubExecExit = dockerService.onAnyExecExit((streamId, code) => {
      const cbs = this.streamExitCallbacks.get(streamId)
      if (cbs) for (const cb of cbs) cb(code)
    })
  }

  get status(): TargetStatus {
    return this._status
  }

  async connect(): Promise<void> {
    // Local target is always connected
  }

  async disconnect(): Promise<void> {
    this.unsubPtyData?.()
    this.unsubPtyExit?.()
    this.unsubExecData?.()
    this.unsubExecExit?.()
    this.unsubPtyData = null
    this.unsubPtyExit = null
    this.unsubExecData = null
    this.unsubExecExit = null
    this._status = 'disconnected'
  }

  // --- PTY operations ---

  async ptyCreate(config: PtyConfig): Promise<string> {
    return Effect.runPromise(this.ptyService.create(config))
  }

  ptyWrite(id: string, data: string): void {
    if (this.execStreamIds.has(id)) {
      this.dockerService.execWrite(id, data)
    } else {
      this.ptyService.write(id, data)
    }
  }

  ptyResize(id: string, cols: number, rows: number): void {
    if (this.execStreamIds.has(id)) {
      this.dockerService.execResize(id, cols, rows)
    } else {
      this.ptyService.resize(id, cols, rows)
    }
  }

  async ptyDestroy(id: string): Promise<void> {
    if (this.execStreamIds.has(id)) {
      this.dockerService.destroyExecStream(id)
      this.execStreamIds.delete(id)
    } else {
      return Effect.runPromise(this.ptyService.destroy(id))
    }
  }

  async ptyGetScrollback(id: string): Promise<string> {
    if (this.execStreamIds.has(id)) {
      return this.dockerService.getExecScrollback(id)
    }
    // The sync `getScrollback(id)` on `@wanda/terminal-engine` always
    // returns `''` in subprocess mode — the real headless lives in the
    // PtyHost subprocess, so scrollback must go through the async IPC.
    return this.ptyService.getScrollbackAsync(id)
  }

  ptyClear(id: string): void {
    if (this.execStreamIds.has(id)) {
      this.dockerService.clearExecScrollback(id)
    } else {
      this.ptyService.clear(id)
    }
  }

  // --- Docker operations ---

  async dockerInspectContainer(id: string): Promise<ContainerInfo | null> {
    return Effect.runPromise(this.dockerService.inspectContainer(id))
  }

  async dockerCreateContainer(opts: ContainerCreateOpts): Promise<string> {
    return Effect.runPromise(this.dockerService.createContainer(opts))
  }

  async dockerStartContainer(id: string): Promise<void> {
    return Effect.runPromise(this.dockerService.startContainer(id))
  }

  async dockerStopContainer(id: string, timeout?: number): Promise<void> {
    return Effect.runPromise(this.dockerService.stopContainer(id, timeout))
  }

  async dockerRemoveContainer(id: string): Promise<void> {
    return Effect.runPromise(this.dockerService.removeContainer(id))
  }

  async dockerListContainers(): Promise<ContainerInfo[]> {
    return Effect.runPromise(this.dockerService.listContainers())
  }

  async dockerExec(opts: DockerExecOpts): Promise<string> {
    const streamId = await Effect.runPromise(this.dockerService.exec(opts))
    this.execStreamIds.add(streamId)
    return streamId
  }

  async *dockerPullImage(image: string): AsyncGenerator<PullProgress> {
    yield* this.dockerService.pullImage(image)
  }

  async *dockerBuildImage(
    dockerfile: string,
    tag: string,
    opts?: { nocache?: boolean },
  ): AsyncGenerator<BuildProgress> {
    yield* this.dockerService.buildImage(dockerfile, tag, opts)
  }

  async dockerCommitContainer(id: string, repo: string, tag: string): Promise<string> {
    return Effect.runPromise(this.dockerService.commitContainer(id, repo, tag))
  }

  async dockerListImages(): Promise<ImageInfo[]> {
    return Effect.runPromise(this.dockerService.listImages())
  }

  // --- Shell execution ---

  async shellExec(opts: {
    command: string
    cwd?: string
    env?: Record<string, string>
  }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const child = spawn(opts.command, {
        shell: true,
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      const done = (exitCode: number) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ stdout, stderr, exitCode })
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        done(124)
      }, 30_000)
      child.stdout?.on('data', (d) => {
        stdout += d.toString('utf-8')
      })
      child.stderr?.on('data', (d) => {
        stderr += d.toString('utf-8')
      })
      child.on('error', () => done(1))
      child.on('close', (code) => done(code ?? 1))
    })
  }

  // --- System ---

  async systemResources(): Promise<ResourceInfo> {
    const dockerAvailable = await Effect.runPromise(this.dockerService.checkDockerAvailable())
    const disk = await statfs('/')
    return {
      hostname: os.hostname(),
      cpus: os.cpus().length,
      memoryTotal: os.totalmem(),
      memoryFree: os.freemem(),
      diskTotal: disk.bsize * disk.blocks,
      diskFree: disk.bsize * disk.bavail,
      dockerAvailable,
    }
  }

  // --- Events ---

  onStreamData(id: string, cb: (data: string) => void): () => void {
    let cbs = this.streamDataCallbacks.get(id)
    if (!cbs) {
      cbs = new Set()
      this.streamDataCallbacks.set(id, cbs)
    }
    cbs.add(cb)
    return () => {
      cbs.delete(cb)
      if (cbs.size === 0) this.streamDataCallbacks.delete(id)
    }
  }

  onStreamExit(id: string, cb: (code: number) => void): () => void {
    let cbs = this.streamExitCallbacks.get(id)
    if (!cbs) {
      cbs = new Set()
      this.streamExitCallbacks.set(id, cbs)
    }
    cbs.add(cb)
    return () => {
      cbs.delete(cb)
      if (cbs.size === 0) this.streamExitCallbacks.delete(id)
    }
  }

  onStatusChange(_cb: (status: TargetStatus) => void): () => void {
    // Local target status never changes (always connected)
    return () => {}
  }
}
