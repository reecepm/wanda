// ---------------------------------------------------------------------------
// WebSocket transport server — attaches to any http.Server.
//
// Bidirectional: handles client input (write/resize/ack) and pushes
// engine output (data/exit) to subscribed clients.
//
// This replaces the pattern where keystrokes went through HTTP POST
// (which doesn't guarantee ordering) with a persistent WebSocket
// connection that guarantees in-order delivery.
// ---------------------------------------------------------------------------

import type { Server as HttpServer, IncomingMessage } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { TerminalEngine } from './engine.js'
import type { ServerFrame } from './protocol.js'
import { encodeServerFrame, parseClientFrame } from './protocol.js'

export interface WsServerOptions {
  /** Path to listen on (default '/terminal'). */
  path?: string
  /** Bearer token for authentication. Omit to skip auth. */
  token?: string
  /** Optional logger. */
  log?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void
}

interface ClientState {
  ws: WebSocket
  subscriptions: Set<string>
}

export class WsTerminalServer {
  private wss: WebSocketServer
  private clients = new Set<ClientState>()
  private unsubData: (() => void) | null = null
  private unsubExit: (() => void) | null = null

  private engine: TerminalEngine
  private opts?: WsServerOptions

  constructor(engine: TerminalEngine, httpServer: HttpServer, opts?: WsServerOptions) {
    this.engine = engine
    this.opts = opts
    const path = opts?.path ?? '/terminal'

    this.wss = new WebSocketServer({
      server: httpServer,
      path,
      verifyClient: opts?.token
        ? (info: { req: IncomingMessage }, done: (result: boolean) => void) => {
            const url = new URL(info.req.url ?? '/', `http://${info.req.headers.host}`)
            const tokenParam = url.searchParams.get('token')
            const authHeader = info.req.headers.authorization
            const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
            const provided = tokenParam ?? bearerToken
            done(provided === opts!.token)
          }
        : undefined,
    })

    this.wss.on('connection', (ws) => {
      const client: ClientState = { ws, subscriptions: new Set() }
      this.clients.add(client)
      this.opts?.log?.('debug', `ws-server: client connected (total: ${this.clients.size})`)

      ws.on('message', (raw) => {
        const msg = typeof raw === 'string' ? raw : raw.toString('utf-8')
        const frame = parseClientFrame(msg)
        if (!frame) return

        switch (frame.t) {
          case 'w':
            this.engine.write(frame.id, frame.d)
            break
          case 'r':
            this.engine.resize(frame.id, frame.c, frame.r)
            break
          case 'a':
            this.engine.ack(frame.id, frame.n)
            break
          case 's':
            client.subscriptions.add(frame.id)
            break
          case 'u':
            client.subscriptions.delete(frame.id)
            break
        }
      })

      ws.on('close', () => {
        this.clients.delete(client)
        this.opts?.log?.('debug', `ws-server: client disconnected (total: ${this.clients.size})`)
      })

      ws.on('error', () => {
        this.clients.delete(client)
      })
    })

    // Wire engine events → client broadcasts
    this.unsubData = engine.on('data', (id, data) => {
      this.broadcast({ t: 'd', id, d: data })
    })

    this.unsubExit = engine.on('exit', (id, code) => {
      this.broadcast({ t: 'x', id, c: code })
    })
  }

  private broadcast(frame: ServerFrame): void {
    if (this.clients.size === 0) return
    const msg = encodeServerFrame(frame)
    for (const client of this.clients) {
      // Only send data frames to subscribers (exit frames always go to everyone)
      if (frame.t === 'd' && !client.subscriptions.has(frame.id)) continue
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(msg)
        } catch (err) {
          this.opts?.log?.('warn', `ws-server: send failed for client: ${err}`)
        }
      }
    }
  }

  /** Shut down the WebSocket server. */
  close(): void {
    this.unsubData?.()
    this.unsubExit?.()
    for (const client of this.clients) {
      try {
        client.ws.close()
      } catch (err) {
        this.opts?.log?.('warn', `ws-server: close failed for client: ${err}`)
      }
    }
    this.clients.clear()
    this.wss.close()
  }
}
