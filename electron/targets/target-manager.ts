import { log } from '../packages/logger'
import type { LocalTarget } from './local-target'
import type { Target } from './target'

/**
 * Stream router + registry for the single local target.
 *
 * After P7 the concept of "remote target" is gone — paired servers are
 * whole wanda-server instances addressed by the client-side
 * ServerRegistry, not dumb executors. TargetManager stays because pod /
 * environment domain code routes PTY streams through it, which decouples
 * that code from the concrete PtyService + DockerService wiring.
 */
export class TargetManager {
  private local: LocalTarget
  private streamToTarget = new Map<string, string>()
  private streamDataCallbacks = new Set<(streamId: string, data: string) => void>()
  private streamExitCallbacks = new Set<(streamId: string, code: number) => void>()
  private streamRegisteredCallbacks = new Set<(streamId: string) => void>()
  private streamUnregisteredCallbacks = new Set<(streamId: string) => void>()
  private streamEventUnsubs = new Map<string, (() => void)[]>()

  constructor(local: LocalTarget) {
    this.local = local
  }

  // --- Registry ---

  getTarget(id: string): Target {
    if (id !== 'local') throw new Error(`Target not found: ${id}`)
    return this.local
  }

  getLocalTarget(): LocalTarget {
    return this.local
  }

  getAllTargets(): Target[] {
    return [this.local]
  }

  // --- Lifecycle ---

  async connectAll(): Promise<void> {
    // Local target has nothing to connect to.
  }

  async disconnectAll(): Promise<void> {
    await this.local.disconnect()
  }

  // --- Stream routing ---

  registerStream(streamId: string, targetId: string): void {
    log.target.debug(`registerStream ${streamId} → ${targetId}`)
    this.streamToTarget.set(streamId, targetId)
    if (targetId !== 'local') {
      log.target.warn(`target "${targetId}" not found — skipping`)
      return
    }

    const unsubs: (() => void)[] = []
    unsubs.push(
      this.local.onStreamData(streamId, (data) => {
        for (const cb of this.streamDataCallbacks) cb(streamId, data)
      }),
    )
    unsubs.push(
      this.local.onStreamExit(streamId, (code) => {
        for (const cb of this.streamExitCallbacks) cb(streamId, code)
      }),
    )

    this.streamEventUnsubs.set(streamId, unsubs)
    for (const cb of this.streamRegisteredCallbacks) cb(streamId)
    log.target.debug(`registerStream done for ${streamId}`)
  }

  unregisterStream(streamId: string): void {
    this.streamToTarget.delete(streamId)
    const unsubs = this.streamEventUnsubs.get(streamId)
    if (unsubs) {
      for (const unsub of unsubs) unsub()
      this.streamEventUnsubs.delete(streamId)
    }
    for (const cb of this.streamUnregisteredCallbacks) cb(streamId)
  }

  /** True if this manager has registered the stream — used by the terminal router
   * to fall back to other stream owners (e.g. workenv exec) for unknown ids. */
  hasStream(streamId: string): boolean {
    return this.streamToTarget.has(streamId)
  }

  writeStream(streamId: string, data: string): void {
    this.local.ptyWrite(streamId, data)
  }

  resizeStream(streamId: string, cols: number, rows: number): void {
    this.local.ptyResize(streamId, cols, rows)
  }

  async shellExec(
    _targetId: string | null,
    opts: { command: string; cwd?: string; env?: Record<string, string> },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return this.local.shellExec(opts)
  }

  async getScrollback(streamId: string): Promise<string> {
    return this.local.ptyGetScrollback(streamId)
  }

  clearStream(streamId: string): void {
    this.local.ptyClear(streamId)
  }

  // --- Events forwarded to renderer ---

  onStreamData(cb: (streamId: string, data: string) => void): () => void {
    this.streamDataCallbacks.add(cb)
    return () => {
      this.streamDataCallbacks.delete(cb)
    }
  }

  onStreamExit(cb: (streamId: string, code: number) => void): () => void {
    this.streamExitCallbacks.add(cb)
    return () => {
      this.streamExitCallbacks.delete(cb)
    }
  }

  onStreamRegistered(cb: (streamId: string) => void): () => void {
    this.streamRegisteredCallbacks.add(cb)
    return () => {
      this.streamRegisteredCallbacks.delete(cb)
    }
  }

  onStreamUnregistered(cb: (streamId: string) => void): () => void {
    this.streamUnregisteredCallbacks.add(cb)
    return () => {
      this.streamUnregisteredCallbacks.delete(cb)
    }
  }
}
