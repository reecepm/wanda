// -----------------------------------------------------------------------------
// Target — abstraction over "a place we run PTYs and Docker containers".
//
// There is only ever one target: the local machine. Domain code
// continues to depend on this interface rather than talking directly to
// PtyService + DockerService so the seam is available if we ever want to
// reintroduce a remote-executor concept (e.g. fly.io / Modal), but it
// has zero remote-relevant surface today.
// -----------------------------------------------------------------------------

export type { PtyConfig } from '../packages/pty/types'
export type {
  BuildProgress,
  ContainerCreateOpts,
  ContainerInfo,
  DockerExecOpts,
  ImageInfo,
  PullProgress,
} from '../services/docker.service'

/** Resource info reported by a target. */
export interface ResourceInfo {
  hostname: string
  cpus: number
  memoryTotal: number // bytes
  memoryFree: number
  diskTotal: number
  diskFree: number
  dockerAvailable: boolean
}

export type TargetStatus = 'connected' | 'disconnected' | 'connecting'

export interface Target {
  readonly id: string
  readonly name: string
  readonly type: 'local'
  readonly status: TargetStatus

  connect(): Promise<void>
  disconnect(): Promise<void>

  // PTY operations
  ptyCreate(config: import('../packages/pty/types').PtyConfig): Promise<string>
  ptyWrite(id: string, data: string): void
  ptyResize(id: string, cols: number, rows: number): void
  ptyDestroy(id: string): Promise<void>
  ptyGetScrollback(id: string): Promise<string>
  ptyClear(id: string): void

  // Docker operations
  dockerCreateContainer(opts: import('../services/docker.service').ContainerCreateOpts): Promise<string>
  dockerStartContainer(id: string): Promise<void>
  dockerStopContainer(id: string, timeout?: number): Promise<void>
  dockerRemoveContainer(id: string): Promise<void>
  dockerInspectContainer(id: string): Promise<import('../services/docker.service').ContainerInfo | null>
  dockerListContainers(): Promise<import('../services/docker.service').ContainerInfo[]>
  dockerExec(opts: import('../services/docker.service').DockerExecOpts): Promise<string>
  dockerPullImage(image: string): AsyncGenerator<import('../services/docker.service').PullProgress>
  dockerBuildImage(
    dockerfile: string,
    tag: string,
    opts?: { nocache?: boolean },
  ): AsyncGenerator<import('../services/docker.service').BuildProgress>
  dockerCommitContainer(id: string, repo: string, tag: string): Promise<string>
  dockerListImages(): Promise<import('../services/docker.service').ImageInfo[]>

  // Shell execution (non-interactive)
  shellExec(opts: {
    command: string
    cwd?: string
    env?: Record<string, string>
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>

  // System
  systemResources(): Promise<ResourceInfo>

  // Events
  onStreamData(id: string, cb: (data: string) => void): () => void
  onStreamExit(id: string, cb: (code: number) => void): () => void
  onStatusChange(cb: (status: TargetStatus) => void): () => void
}
