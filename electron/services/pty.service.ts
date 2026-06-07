import type { PtyConfig as EnginePtyConfig } from '@wanda/terminal-engine'
import { TerminalEngine } from '@wanda/terminal-engine'
import { Context, Effect, Layer } from 'effect'
import { log } from '../packages/logger'

export interface PtyConfig extends EnginePtyConfig {
  /** Per-terminal exit callback. Fired when the PTY process exits. */
  onExit?: (id: string, exitCode: number) => void
}

export interface PtyServiceShape {
  // Effect-wrapped commands
  readonly create: (config: PtyConfig) => Effect.Effect<string>
  readonly destroy: (id: string) => Effect.Effect<void>
  readonly restart: (id: string) => Effect.Effect<void>
  readonly list: () => Effect.Effect<
    Array<{
      id: string
      config: PtyConfig
      status: 'running' | 'stopped' | 'crashed'
      exitCode?: number
      restartCount: number
    }>
  >

  // Raw methods for hot path (no Effect overhead)
  readonly write: (id: string, data: string) => void
  readonly resize: (id: string, cols: number, rows: number) => void
  readonly getScrollback: (id: string) => string
  readonly getScrollbackAsync: (id: string) => Promise<string>
  readonly clear: (id: string) => void
  readonly destroyAll: () => void

  // Global stream listeners (for daemon forwarding + target wiring)
  readonly onAnyData: (cb: (id: string, data: string) => void) => () => void
  readonly onAnyExit: (cb: (id: string, code: number) => void) => () => void

  // Subscribe model — only subscribed terminals push data to listeners
  readonly subscribe: (id: string) => void
  readonly unsubscribe: (id: string) => void

  // Flow control ack
  readonly ack: (id: string, bytes: number) => void

  /**
   * Late-bind the snapshot directory. Called once at server startup
   * when the data directory is known. Creates the TerminalEngine
   * subprocess with persistence enabled.
   */
  readonly configure: (snapshotDir: string) => void

  // Lifecycle
  readonly engine: TerminalEngine
  readonly ready: Promise<void>
}

export class PtyService extends Context.Tag('PtyService')<PtyService, PtyServiceShape>() {}

const engineLog = (level: string, msg: string) => {
  if (level === 'error') log.pty.error(msg)
  else if (level === 'warn') log.pty.warn(msg)
  else if (level === 'info') log.pty.info(msg)
  else log.pty.debug(msg)
}

export const PtyServiceLive = Layer.sync(PtyService, () => {
  let engine = new TerminalEngine({ log: engineLog })

  // Track per-terminal onExit callbacks from PtyConfig
  const exitCallbacks = new Map<string, (id: string, exitCode: number) => void>()

  // Wire global exit listener to dispatch per-config callbacks
  let unsubExit = engine.on('exit', (id, code) => {
    const cb = exitCallbacks.get(id)
    if (cb) {
      exitCallbacks.delete(id)
      cb(id, code)
    }
  })

  const configure = (snapshotDir: string) => {
    unsubExit()
    engine.dispose()
    engine = new TerminalEngine({ snapshotDir, log: engineLog })
    unsubExit = engine.on('exit', (id, code) => {
      const cb = exitCallbacks.get(id)
      if (cb) {
        exitCallbacks.delete(id)
        cb(id, code)
      }
    })
  }

  const svc: PtyServiceShape = {
    create: (config) =>
      Effect.sync(() => {
        const id = engine.create(config)
        if (config.onExit) exitCallbacks.set(id, config.onExit)
        return id
      }),
    destroy: (id) => Effect.sync(() => engine.destroy(id)),
    restart: (_id) =>
      Effect.sync(() => {
        // Restart is handled at the pod controller level via restartPolicy.
        // TerminalEngine destroy + create achieves the same result.
      }),
    list: () => Effect.sync(() => engine.list()),

    write: (id, data) => engine.write(id, data),
    resize: (id, cols, rows) => engine.resize(id, cols, rows),
    getScrollback: (id) => engine.getScrollback(id),
    getScrollbackAsync: (id) => engine.getScrollbackAsync(id),
    clear: (id) => engine.clear(id),
    destroyAll: () => engine.dispose(),

    onAnyData: (cb) => engine.on('data', cb),
    onAnyExit: (cb) => engine.on('exit', cb),

    subscribe: (id) => engine.subscribe(id),
    unsubscribe: (id) => engine.unsubscribe(id),
    ack: (id, bytes) => engine.ack(id, bytes),

    configure,

    get engine() {
      return engine
    },
    get ready() {
      return engine.ready
    },
  }

  return svc
})
