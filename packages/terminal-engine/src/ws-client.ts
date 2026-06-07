// ---------------------------------------------------------------------------
// WebSocket transport client — browser-safe module (no Node imports).
//
// Connects to a WsTerminalServer, sends input/resize/ack frames, and
// demultiplexes incoming data/exit frames to per-terminal callbacks.
//
// Includes auto-reconnect with exponential backoff and automatic flow
// control acking (sends ack every ACK_INTERVAL bytes received).
// ---------------------------------------------------------------------------

import type { ClientFrame, ServerFrame } from './protocol.js'

const ACK_INTERVAL = 5_000 // Send ack every 5KB received (matches VS Code)
const RECONNECT_BASE_MS = 250
const RECONNECT_MAX_MS = 10_000

export interface WsClientOptions {
  /** WebSocket URL (e.g. 'ws://localhost:9191/terminal'). */
  url: string
  /** Bearer token for auth (sent as ?token= query param). */
  token?: string
  /** Disable auto-ack (for custom flow control). */
  disableAutoAck?: boolean
}

type DataCallback = (data: string) => void
type ExitCallback = (code: number) => void
type ConnectionCallback = (status: 'connecting' | 'connected' | 'disconnected') => void

export class WsTerminalClient {
  private ws: WebSocket | null = null
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private dataListeners = new Map<string, Set<DataCallback>>()
  private exitListeners = new Map<string, Set<ExitCallback>>()
  private connectionListeners = new Set<ConnectionCallback>()
  private unackedBytes = new Map<string, number>()
  private readonly autoAck: boolean

  private readonly opts: WsClientOptions

  constructor(opts: WsClientOptions) {
    this.opts = opts
    this.autoAck = !opts.disableAutoAck
    this.connect()
  }

  private connect(): void {
    if (this.disposed) return
    this.notifyConnection('connecting')

    const url = new URL(this.opts.url)
    if (this.opts.token) {
      url.searchParams.set('token', this.opts.token)
    }

    this.ws = new WebSocket(url.toString())

    this.ws.addEventListener('open', () => {
      this.reconnectAttempt = 0
      this.notifyConnection('connected')

      // Re-subscribe to all active terminals
      for (const id of this.dataListeners.keys()) {
        this.send({ t: 's', id })
      }
    })

    this.ws.addEventListener('message', (event) => {
      try {
        const frame = JSON.parse(typeof event.data === 'string' ? event.data : '') as ServerFrame
        if (!frame || typeof frame !== 'object' || typeof frame.t !== 'string') return

        switch (frame.t) {
          case 'd': {
            const subs = this.dataListeners.get(frame.id)
            if (subs) {
              for (const cb of subs) cb(frame.d)
            }
            // Auto-ack flow control
            if (this.autoAck) {
              const pending = (this.unackedBytes.get(frame.id) ?? 0) + frame.d.length
              if (pending >= ACK_INTERVAL) {
                this.send({ t: 'a', id: frame.id, n: pending })
                this.unackedBytes.set(frame.id, 0)
              } else {
                this.unackedBytes.set(frame.id, pending)
              }
            }
            break
          }
          case 'x': {
            const subs = this.exitListeners.get(frame.id)
            if (subs) {
              for (const cb of subs) cb(frame.c)
            }
            break
          }
        }
      } catch (err) {
        console.warn('[ws-client] malformed frame:', err)
      }
    })

    this.ws.addEventListener('close', () => {
      this.notifyConnection('disconnected')
      if (!this.disposed) {
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt)
        this.reconnectAttempt++
        this.reconnectTimer = setTimeout(() => this.connect(), delay * Math.random())
      }
    })

    this.ws.addEventListener('error', () => {
      // error is followed by close
    })
  }

  /** Send input data to a terminal. */
  write(id: string, data: string): void {
    this.send({ t: 'w', id, d: data })
  }

  /** Resize a terminal. */
  resize(id: string, cols: number, rows: number): void {
    this.send({ t: 'r', id, c: cols, r: rows })
  }

  /** Manually ack bytes (only needed if autoAck is disabled). */
  ack(id: string, bytes: number): void {
    this.send({ t: 'a', id, n: bytes })
  }

  /** Subscribe to data from a terminal. Returns unsubscribe function. */
  onData(id: string, cb: DataCallback): () => void {
    let subs = this.dataListeners.get(id)
    if (!subs) {
      subs = new Set()
      this.dataListeners.set(id, subs)
      // Tell server to start sending data for this terminal
      this.send({ t: 's', id })
    }
    subs.add(cb)

    return () => {
      subs.delete(cb)
      if (subs.size === 0) {
        this.dataListeners.delete(id)
        this.send({ t: 'u', id })
      }
    }
  }

  /** Subscribe to exit events from a terminal. Returns unsubscribe function. */
  onExit(id: string, cb: ExitCallback): () => void {
    let subs = this.exitListeners.get(id)
    if (!subs) {
      subs = new Set()
      this.exitListeners.set(id, subs)
    }
    subs.add(cb)
    return () => {
      subs.delete(cb)
      if (subs.size === 0) this.exitListeners.delete(id)
    }
  }

  /** Subscribe to connection status changes. */
  onConnection(cb: ConnectionCallback): () => void {
    this.connectionListeners.add(cb)
    return () => {
      this.connectionListeners.delete(cb)
    }
  }

  private send(frame: ClientFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(frame))
      } catch (err) {
        console.warn('[ws-client] send failed:', err)
      }
    }
  }

  private notifyConnection(status: 'connecting' | 'connected' | 'disconnected'): void {
    for (const cb of this.connectionListeners) cb(status)
  }

  /** Disconnect and clean up. */
  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    try {
      this.ws?.close()
    } catch (err) {
      console.warn('[ws-client] close failed during dispose:', err)
    }
    this.dataListeners.clear()
    this.exitListeners.clear()
    this.connectionListeners.clear()
  }
}
