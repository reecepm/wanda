// -----------------------------------------------------------------------------
// End-to-end pairing integration test.
//
// Exercises the full bootstrap → capabilities → ws-token → WS upgrade flow
// against a bare http.Server wired to both the AuthStore HTTP handler and
// a WsGateway with the store's ws-token consumer plugged in.
// -----------------------------------------------------------------------------

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventLog } from '@wanda/event-log'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { BootstrapResult, WsTokenResult } from '../../../shared/contracts/auth'
import type { ServerCapabilities } from '../../../shared/contracts/capabilities'
import { createAuthHttpHandler, createInMemoryAuthStore } from '../auth'
import { WsGateway } from '../ws-gateway'

const CLIENT = { deviceName: 'laptop', os: 'darwin', appVersion: '0.0.0-int' }

const CAPS: ServerCapabilities = {
  serverId: 'srv-int',
  hostname: 'int-host',
  appVersion: '0.0.0-int',
  ssh: null,
  features: { docker: true, agents: true, workspaceRoot: '/tmp/ws' },
}

describe('auth + ws-gateway integration', () => {
  let server: HttpServer
  let gateway: WsGateway
  let eventLog: EventLog
  let port: number
  let store: ReturnType<typeof createInMemoryAuthStore>

  beforeEach(async () => {
    store = createInMemoryAuthStore(CAPS.serverId)
    const authHandler = createAuthHttpHandler({ store, capabilities: CAPS })

    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const handled = await authHandler(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end()
      }
    })

    eventLog = new EventLog(new Database(':memory:'), { epoch: 1, ownsDb: true })
    gateway = new WsGateway({
      authStore: store,
      serverId: CAPS.serverId,
      epoch: 1,
    })
    gateway.attachTo(server, eventLog)

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    port = (server.address() as AddressInfo).port
  })

  afterEach(async () => {
    await gateway.close()
    eventLog.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('a client walks through pairing → capabilities → ws-token → WS upgrade', async () => {
    // 1. Server operator generates a pairing token (printed on stdout in prod).
    const pairing = store.createPairingToken()

    // 2. Client bootstraps.
    const bootstrapRes = await fetch(`http://127.0.0.1:${port}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairingToken: pairing.token, client: CLIENT }),
    })
    expect(bootstrapRes.status).toBe(200)
    const bootstrap = (await bootstrapRes.json()) as BootstrapResult
    expect(bootstrap.sessionToken).toBeTruthy()
    expect(bootstrap.serverId).toBe(CAPS.serverId)

    // 3. Client fetches capabilities using the session token.
    const capsRes = await fetch(`http://127.0.0.1:${port}/api/capabilities`, {
      headers: { authorization: `Bearer ${bootstrap.sessionToken}` },
    })
    expect(capsRes.status).toBe(200)
    const caps = (await capsRes.json()) as ServerCapabilities
    expect(caps.serverId).toBe(CAPS.serverId)

    // 4. Client requests a WS token.
    const wstRes = await fetch(`http://127.0.0.1:${port}/api/auth/ws-token`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bootstrap.sessionToken}` },
    })
    expect(wstRes.status).toBe(200)
    const wst = (await wstRes.json()) as WsTokenResult

    // 5. Client uses the WS token to open a WebSocket.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/events?wsToken=${wst.wsToken}`)
    const opened = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 2000)
      ws.once('open', () => {
        clearTimeout(t)
        resolve(true)
      })
      ws.once('error', () => {
        clearTimeout(t)
        resolve(false)
      })
    })
    expect(opened).toBe(true)

    // 6. Reuse of the same ws-token must fail (one-shot).
    const wsReuse = new WebSocket(`ws://127.0.0.1:${port}/events?wsToken=${wst.wsToken}`)
    const secondOpened = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 1000)
      wsReuse.once('open', () => {
        clearTimeout(t)
        resolve(true)
      })
      wsReuse.once('unexpected-response', () => {
        clearTimeout(t)
        resolve(false)
      })
      wsReuse.once('error', () => {
        clearTimeout(t)
        resolve(false)
      })
    })
    expect(secondOpened).toBe(false)

    ws.close()
  })

  it('revoking a session prevents subsequent capability + ws-token calls', async () => {
    const pairing = store.createPairingToken()
    const bootstrap = store.consumePairingToken(pairing.token, CLIENT)!
    store.revokeSession(bootstrap.sessionId)

    const capsRes = await fetch(`http://127.0.0.1:${port}/api/capabilities`, {
      headers: { authorization: `Bearer ${bootstrap.sessionToken}` },
    })
    expect(capsRes.status).toBe(401)

    const wstRes = await fetch(`http://127.0.0.1:${port}/api/auth/ws-token`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bootstrap.sessionToken}` },
    })
    expect(wstRes.status).toBe(401)
  })
})
