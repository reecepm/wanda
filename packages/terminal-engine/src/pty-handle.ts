// ---------------------------------------------------------------------------
// PtyHandle — manages a single PTY process + its headless scrollback.
//
// Decoupled from any transport or IPC mechanism. The engine wires data
// callbacks to the batcher/flow-control/broadcast layers.
// ---------------------------------------------------------------------------

import os from 'node:os'
import * as pty from 'node-pty'
import { HeadlessScrollback } from './headless-scrollback.js'
import { ensureUtf8Locale } from './locale-env.js'
import type { PtyConfig, TerminalInfo } from './types.js'
import { STRIPPED_ENV_VARS } from './types.js'

function cleanEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v != null) env[k] = v
  }
  if (extra) Object.assign(env, extra)
  for (const key of STRIPPED_ENV_VARS) {
    delete env[key]
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  // Electron launched from Finder/Dock can have no locale or a C/POSIX
  // locale. CLIs that probe locale (Graphite, git pretty printers, etc.)
  // then fall back to byte-escaped output for Unicode tree characters.
  return ensureUtf8Locale(env, os.platform())
}

export type DataCallback = (data: string) => void
export type ExitCallback = (code: number) => void
export type ErrorCallback = (context: string, error: unknown) => void

export class PtyHandle {
  readonly id: string
  readonly config: PtyConfig
  private ptyProcess: pty.IPty
  headless: HeadlessScrollback | null
  status: 'running' | 'stopped' | 'crashed' = 'running'
  exitCode?: number
  restartCount = 0
  bytesOut = 0
  bytesIn = 0

  /** Pending data chunks for deferred headless write. */
  private headlessPending: string[] = []
  private headlessPendingBytes = 0
  private headlessFlushScheduled = false
  // Cap pending headless data — if the event loop can't keep up, drop excess.
  // The raw log on disk is the authoritative record; headless is just a cache.
  private static readonly HEADLESS_MAX_PENDING = 256_000 // 256KB

  /** Pending data for deferred callback dispatch. */
  private callbackPending: string[] = []
  private callbackFlushScheduled = false

  /** When false, headless writes are skipped to reduce CPU for background terminals. */
  private headlessActive = true

  private dataCbs = new Set<DataCallback>()
  private exitCbs = new Set<ExitCallback>()
  private errorCb: ErrorCallback | null = null

  constructor(id: string, config: PtyConfig) {
    this.id = id
    this.config = config

    const shell = config.command ?? (os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash')
    const args = config.args ?? []
    const cols = config.cols ?? 80
    const rows = config.rows ?? 30

    this.ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: config.cwd,
      env: cleanEnv(config.env),
    })

    this.headless = new HeadlessScrollback({ cols, rows })
    this.wireEvents()
  }

  /** Set an error handler. Called when PTY operations fail. */
  onError(cb: ErrorCallback): void {
    this.errorCb = cb
  }

  private emitError(context: string, error: unknown): void {
    if (this.errorCb) {
      this.errorCb(context, error)
    } else {
      // No handler — log to stderr so errors aren't silently lost
      console.error(`[pty-handle:${this.id.slice(0, 8)}] ${context}:`, error)
    }
  }

  private wireEvents(): void {
    this.ptyProcess.onData((data) => {
      this.bytesOut += data.length

      // Defer headless write — only needed for subscribed (active) terminals.
      // Background terminals reconstruct from raw log when switched to.
      if (this.headless && this.headlessActive) {
        if (this.headlessPendingBytes < PtyHandle.HEADLESS_MAX_PENDING) {
          this.headlessPending.push(data)
          this.headlessPendingBytes += data.length
        }
        if (!this.headlessFlushScheduled) {
          this.headlessFlushScheduled = true
          setImmediate(() => this.flushHeadless())
        }
      }

      // Defer callback dispatch via setImmediate. This yields the event loop
      // between PTY reads, preventing N terminals from monopolizing a single
      // event loop turn. Input writes and timer callbacks get a chance to run
      // between data batches.
      this.callbackPending.push(data)
      if (!this.callbackFlushScheduled) {
        this.callbackFlushScheduled = true
        setImmediate(() => this.flushCallbacks())
      }
    })

    this.ptyProcess.onExit(({ exitCode }) => {
      this.status = exitCode === 0 ? 'stopped' : 'crashed'
      this.exitCode = exitCode
      for (const cb of this.exitCbs) cb(exitCode)
    })
  }

  write(data: string): void {
    if (this.status !== 'running') return
    try {
      this.bytesIn += data.length
      this.ptyProcess.write(data)
    } catch (err) {
      this.emitError('write', err)
    }
  }

  resize(cols: number, rows: number): void {
    try {
      this.ptyProcess.resize(cols, rows)
    } catch (err) {
      this.emitError('resize', err)
    }
    this.headless?.resize(cols, rows)
  }

  /** Pause PTY output (flow control). */
  pause(): void {
    try {
      this.ptyProcess.pause()
    } catch (err) {
      this.emitError('pause', err)
    }
  }

  /** Resume PTY output (flow control). */
  resume(): void {
    try {
      this.ptyProcess.resume()
    } catch (err) {
      this.emitError('resume', err)
    }
  }

  restart(): void {
    try {
      this.ptyProcess.kill()
    } catch (err) {
      this.emitError('kill-before-restart', err)
    }
    this.restartCount++

    const shell = this.config.command ?? (os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash')
    const args = this.config.args ?? []
    const cols = this.config.cols ?? 80
    const rows = this.config.rows ?? 30

    this.ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: this.config.cwd,
      env: cleanEnv(this.config.env),
    })

    this.status = 'running'
    this.headless?.dispose()
    this.headless = new HeadlessScrollback({ cols, rows })
    this.wireEvents()
  }

  kill(): void {
    try {
      this.ptyProcess.kill()
    } catch (err) {
      this.emitError('kill', err)
    }
    this.headless?.dispose()
    this.headless = null
  }

  /** Enable real-time headless processing (for active/subscribed terminals). */
  setHeadlessActive(active: boolean): void {
    this.headlessActive = active
  }

  /** Dispatch pending data to user callbacks. */
  private flushCallbacks(): void {
    this.callbackFlushScheduled = false
    if (this.callbackPending.length === 0) return
    const chunks = this.callbackPending
    this.callbackPending = []
    const merged = chunks.length === 1 ? chunks[0] : chunks.join('')
    for (const cb of this.dataCbs) cb(merged)
  }

  /**
   * Drop captured scrollback: dispose the headless terminal and create a
   * fresh one at the current dimensions. Pending/queued data is also
   * discarded so old bytes don't replay into the new buffer.
   */
  clearScrollback(): void {
    const cols = this.config.cols ?? 80
    const rows = this.config.rows ?? 30
    this.headlessPending = []
    this.headlessPendingBytes = 0
    this.headlessFlushScheduled = false
    this.headless?.dispose()
    this.headless = new HeadlessScrollback({ cols, rows })
  }

  /** Drain pending data into the headless terminal. */
  flushHeadless(): void {
    this.headlessFlushScheduled = false
    if (!this.headless || this.headlessPending.length === 0) return
    const chunks = this.headlessPending
    this.headlessPending = []
    this.headlessPendingBytes = 0
    for (const chunk of chunks) {
      this.headless.write(chunk)
    }
  }

  getScrollback(): string {
    this.flushHeadless()
    return this.headless?.serialize() ?? ''
  }

  onData(cb: DataCallback): () => void {
    this.dataCbs.add(cb)
    return () => {
      this.dataCbs.delete(cb)
    }
  }

  onExit(cb: ExitCallback): () => void {
    this.exitCbs.add(cb)
    return () => {
      this.exitCbs.delete(cb)
    }
  }

  toInfo(): TerminalInfo {
    return {
      id: this.id,
      config: this.config,
      status: this.status,
      exitCode: this.exitCode,
      restartCount: this.restartCount,
    }
  }
}
