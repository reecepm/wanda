// ---------------------------------------------------------------------------
// TerminalEngine — top-level orchestrator.
//
// Spawns a PtyHost child process and communicates via binary-framed stdio
// pipes (stdin for commands, stdout for events). Uses separate unidirectional
// pipes to eliminate the deadlock inherent in Node.js IPC's single
// bidirectional socket.
//
// Usage:
//   const engine = new TerminalEngine({ snapshotDir: '/tmp/scrollback' })
//   await engine.ready
//   const id = engine.create({ cwd: os.homedir() })
//   engine.on('data', (id, data) => sendToClient(data))
//   engine.write(id, 'ls\n')
//   engine.ack(id, 1024)
// ---------------------------------------------------------------------------

import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CreatePayload } from './pty-host-protocol.js'
import {
  buildAckPayload,
  buildDataPayload,
  buildIdPayload,
  buildResizePayload,
  buildScrollbackPayload,
  FrameDecoder,
  HostCmd,
  HostEvt,
  ID_BYTES,
  writeFrame,
} from './pty-host-protocol.js'
import type { EngineMetrics, EngineOptions, PtyConfig, TerminalInfo } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

type DataListener = (id: string, data: string) => void
type ExitListener = (id: string, code: number) => void

const MAX_STDIN_QUEUE_BYTES = 2_000_000 // 2MB cap on queued commands
const WRITE_CHUNK_SIZE = 8192 // Split large writes into 8KB frames

export class TerminalEngine {
  private host: ChildProcess
  private dataListeners = new Set<DataListener>()
  private exitListeners = new Set<ExitListener>()
  private pendingScrollbacks = new Map<number, (data: string) => void>()
  private reqCounter = 0
  private stdinQueueBytes = 0
  private stdinDrainArmed = false
  private disposing = false

  /** Resolves when the PtyHost process is ready. */
  readonly ready: Promise<void>

  constructor(options?: EngineOptions) {
    const currentExt = import.meta.url.endsWith('.ts') ? '.ts' : '.js'
    const hostPath = join(__dirname, `pty-host${currentExt}`)

    const hostArgs = [
      options?.snapshotDir ?? '',
      String(options?.highWaterMark ?? 100_000),
      String(options?.lowWaterMark ?? 5_000),
      String(options?.batchIntervalMs ?? 4),
      String(options?.batchMaxBytes ?? 128_000),
    ]

    this.host = spawn(process.execPath, [...(currentExt === '.ts' ? ['--import', 'tsx'] : []), hostPath, ...hostArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })

    // Wire stdout → frame decoder → event dispatch
    const decoder = new FrameDecoder()
    this.host.stdout!.on('data', (chunk: Buffer) => {
      const frames = decoder.push(chunk)
      for (const frame of frames) {
        this.handleFrame(frame.type, frame.payload)
      }
    })

    // Wire stderr → log
    this.host.stderr!.on('data', (data: Buffer) => {
      options?.log?.('error', `[pty-host] ${data.toString().trim()}`)
    })

    // Detect subprocess death
    this.host.on('exit', (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code}`
      const expected = code === 0 || (this.disposing && (signal === 'SIGTERM' || signal === 'SIGKILL'))
      const message = expected
        ? `PtyHost process exited (${reason})`
        : `PtyHost process exited unexpectedly (${reason})`
      if (options?.log) {
        options.log(expected ? 'debug' : 'error', message)
      } else if (!expected) {
        console.error(`[terminal-engine] ${message}`)
      }
    })

    this.host.on('error', (err) => {
      console.error('[terminal-engine] PtyHost process error:', err)
      options?.log?.('error', `PtyHost process error: ${err.message}`)
    })

    // Wire stdin backpressure
    this.host.stdin!.on('drain', () => {
      this.stdinDrainArmed = false
    })
    // Swallow EPIPE so a dead subprocess during a pending write doesn't
    // bubble up to Electron's uncaughtException (which shows a native
    // error dialog on macOS). The subprocess died — we're about to
    // restart or tear down; nothing to recover.
    this.host.stdin!.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE' && err.code !== 'ERR_STREAM_DESTROYED') {
        console.error('[terminal-engine] stdin error:', err)
      }
    })

    // Ready promise — resolves when host sends Ready frame
    this.ready = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 5000)
      const check = (type: number) => {
        if (type === HostEvt.Ready) {
          clearTimeout(timeout)
          resolve()
        }
      }
      // Temporary handler — replaced by normal handleFrame once ready
      this._readyCheck = check
    })
  }

  private _readyCheck: ((type: number) => void) | null = null

  private handleFrame(type: number, payload: Buffer): void {
    // Check ready
    if (this._readyCheck) {
      this._readyCheck(type)
      if (type === HostEvt.Ready) {
        this._readyCheck = null
        return
      }
    }

    switch (type) {
      case HostEvt.Data: {
        const id = payload.toString('ascii', 0, ID_BYTES)
        const data = payload.toString('utf-8', ID_BYTES)
        for (const cb of this.dataListeners) cb(id, data)
        break
      }
      case HostEvt.Exit: {
        const id = payload.toString('ascii', 0, ID_BYTES)
        const code = payload.readInt32LE(ID_BYTES)
        for (const cb of this.exitListeners) cb(id, code)
        break
      }
      case HostEvt.ScrollbackReply: {
        const reqId = payload.readUInt32LE(0)
        const data = payload.toString('utf-8', 4)
        const resolve = this.pendingScrollbacks.get(reqId)
        if (resolve) {
          this.pendingScrollbacks.delete(reqId)
          resolve(data)
        }
        break
      }
    }
  }

  private sendFrame(type: number, payload?: Buffer): void {
    const stdin = this.host.stdin
    if (!stdin || stdin.destroyed || !stdin.writable) {
      console.error(
        `[terminal-engine] sendFrame(type=${type}) dropped: PtyHost stdin is ${stdin ? 'destroyed' : 'null'}`,
      )
      return
    }

    const payloadLen = payload?.length ?? 0
    this.stdinQueueBytes += 5 + payloadLen

    // Drop if queue is too large (prevents OOM if subprocess is slow)
    if (this.stdinQueueBytes > MAX_STDIN_QUEUE_BYTES) {
      console.warn(
        `[terminal-engine] stdin queue overflow (${this.stdinQueueBytes} bytes), dropping frame type=${type}`,
      )
      this.stdinQueueBytes -= 5 + payloadLen
      return
    }

    // Wrap in try/catch: the subprocess can die between the
    // destroyed-check above and the actual write(), producing EPIPE
    // synchronously. That bubbles up as an uncaughtException, which on
    // Electron triggers the native error dialog. Dropping the frame
    // silently is correct — we were already losing it. Only decrement
    // the queue byte accounting on success so failed writes don't drive
    // the counter negative and defeat MAX_STDIN_QUEUE_BYTES protection.
    let succeeded = false
    try {
      const canWrite = writeFrame(stdin, type, payload)
      succeeded = true
      if (!canWrite && !this.stdinDrainArmed) {
        this.stdinDrainArmed = true
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code
      if (code !== 'EPIPE' && code !== 'ERR_STREAM_DESTROYED') {
        throw err
      }
    }
    if (succeeded) {
      this.stdinQueueBytes -= 5 + payloadLen
    }
  }

  /** Create a new terminal instance. Returns the terminal ID. */
  create(config: PtyConfig): string {
    const id = randomUUID()
    const createPayload: CreatePayload = { id, config }
    this.sendFrame(HostCmd.Create, Buffer.from(JSON.stringify(createPayload), 'utf-8'))
    return id
  }

  /** Destroy a terminal instance. */
  destroy(id: string): void {
    this.sendFrame(HostCmd.Destroy, buildIdPayload(id))
  }

  /** Write input data to a terminal's PTY. */
  write(id: string, data: string): void {
    // Chunk large writes to avoid huge frames
    if (data.length <= WRITE_CHUNK_SIZE) {
      this.sendFrame(HostCmd.Write, buildDataPayload(id, data))
    } else {
      for (let offset = 0; offset < data.length; offset += WRITE_CHUNK_SIZE) {
        const chunk = data.slice(offset, offset + WRITE_CHUNK_SIZE)
        this.sendFrame(HostCmd.Write, buildDataPayload(id, chunk))
      }
    }
  }

  /** Resize a terminal's PTY. */
  resize(id: string, cols: number, rows: number): void {
    this.sendFrame(HostCmd.Resize, buildResizePayload(id, cols, rows))
  }

  /** Acknowledge that the client has processed N bytes (flow control). */
  ack(id: string, bytes: number): void {
    this.sendFrame(HostCmd.Ack, buildAckPayload(id, bytes))
  }

  /** Subscribe to data events for a terminal. */
  subscribe(id: string): void {
    this.sendFrame(HostCmd.Subscribe, buildIdPayload(id))
  }

  /**
   * Clear scrollback for a terminal: resets the headless buffer + drops
   * the on-disk snapshot/rawlog. The PTY process is unaffected — only
   * the captured history. The next `getScrollback()` returns empty.
   */
  clear(id: string): void {
    this.sendFrame(HostCmd.Clear, buildIdPayload(id))
  }

  /** Stop receiving data events for a terminal. The PTY keeps running. */
  unsubscribe(id: string): void {
    this.sendFrame(HostCmd.Unsubscribe, buildIdPayload(id))
  }

  /** Get serialized scrollback for a terminal. */
  async getScrollbackAsync(id: string): Promise<string> {
    const reqId = ++this.reqCounter
    this.sendFrame(HostCmd.Scrollback, buildScrollbackPayload(id, reqId))
    return new Promise<string>((resolve) => {
      this.pendingScrollbacks.set(reqId, resolve)
      setTimeout(() => {
        if (this.pendingScrollbacks.delete(reqId)) {
          resolve('')
        }
      }, 5000)
    })
  }

  /** Sync scrollback — not available in subprocess mode. Use getScrollbackAsync. */
  getScrollback(_id: string): string {
    return ''
  }

  /** List — not available synchronously in subprocess mode. */
  list(): TerminalInfo[] {
    return []
  }

  /** Metrics — not available synchronously in subprocess mode. */
  getMetrics(): EngineMetrics {
    return { terminals: 0, perTerminal: new Map() }
  }

  /** Subscribe to terminal data events. Returns unsubscribe function. */
  on(event: 'data', cb: DataListener): () => void
  on(event: 'exit', cb: ExitListener): () => void
  on(event: 'data' | 'exit', cb: DataListener | ExitListener): () => void {
    if (event === 'data') {
      const listener = cb as DataListener
      this.dataListeners.add(listener)
      return () => {
        this.dataListeners.delete(listener)
      }
    } else {
      const listener = cb as ExitListener
      this.exitListeners.add(listener)
      return () => {
        this.exitListeners.delete(listener)
      }
    }
  }

  /** Tear down the engine: kill the PtyHost process. */
  dispose(): void {
    this.disposing = true
    try {
      this.sendFrame(HostCmd.Dispose)
    } catch (err) {
      console.error('[terminal-engine] failed to send dispose to pty-host:', err)
    }
    setTimeout(() => {
      if (this.host.exitCode === null) {
        this.host.kill('SIGKILL')
      }
    }, 2000)
  }
}
