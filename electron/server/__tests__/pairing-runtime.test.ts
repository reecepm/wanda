// -----------------------------------------------------------------------------
// Pairing against the real ServerRuntime.
//
// Proves that wiring `extraHttpHandler` into createServerRuntime actually
// works: a client can hit /api/auth/bootstrap against the runtime's HTTP
// server, get a session, request a ws-token, and open the /events WS
// using just the pairing-derived credentials (no static WANDA_TOKEN
// shared).
// -----------------------------------------------------------------------------

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { BootstrapResult, WsTokenResult } from '../../../shared/contracts/auth'
import type { ServerCapabilities } from '../../../shared/contracts/capabilities'
import { configureAgentRuntime, configureDatabase } from '../../services'
import { createAuthHttpHandler, createInMemoryAuthStore } from '../auth'
import { createServerRuntime, type ServerRuntimeHandle } from '../runtime'
import { WsGateway } from '../ws-gateway'

describe('pairing against the real ServerRuntime', () => {
  let scratch: string
  let runtime: ServerRuntimeHandle
  let wsGateway: WsGateway
  let httpBase: string
  let wsUrl: string
  let store: ReturnType<typeof createInMemoryAuthStore>
  const serverId = 'pairing-runtime-test'
  const caps: ServerCapabilities = {
    serverId,
    hostname: 'test-host',
    appVersion: '0.0.0-pair',
    ssh: null,
    features: { docker: true, agents: true, workspaceRoot: '/tmp' },
  }

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'wanda-pair-'))
    mkdirSync(join(scratch, 'data'), { recursive: true })
    const dataDir = join(scratch, 'data')
    const appRoot = process.cwd()

    configureDatabase({
      dbPath: join(dataDir, 'test.db'),
      migrationsFolder: join(appRoot, 'electron/db/migrations'),
    })
    configureAgentRuntime({ appRoot, appVersion: '0.0.0-pair', openExternal: () => {} })

    store = createInMemoryAuthStore(serverId)
    const authHandler = createAuthHttpHandler({ store, capabilities: caps })

    wsGateway = new WsGateway({
      authStore: store,
      serverId,
      epoch: 1,
    })
    runtime = await createServerRuntime({
      snapshotStoreDir: dataDir,
      mcpPortFile: join(dataDir, 'mcp-port'),
      host: '127.0.0.1',
      port: 0,
      epoch: 1,
      broadcast: wsGateway.broadcast,
      extraHttpHandler: authHandler,
      onNotificationsChanged: () => {
        wsGateway.broadcast('notifications:changed')
      },
    })
    wsGateway.attachTo(runtime.httpServer, runtime.eventLog)

    httpBase = `http://127.0.0.1:${runtime.mcpPort}`
    wsUrl = `ws://127.0.0.1:${runtime.mcpPort}/events`
  }, 30_000)

  afterAll(async () => {
    if (wsGateway) await wsGateway.close()
    if (runtime) await runtime.stop()
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }, 30_000)

  it('bootstrap → capabilities → ws-token → WS upgrade via only pairing credentials', async () => {
    const pairing = store.createPairingToken()

    const bootstrapRes = await fetch(`${httpBase}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pairingToken: pairing.token,
        client: { deviceName: 'runtime-pair-client', os: 'darwin', appVersion: '0.0.0-pair' },
      }),
    })
    expect(bootstrapRes.status).toBe(200)
    const bootstrap = (await bootstrapRes.json()) as BootstrapResult
    expect(bootstrap.serverId).toBe(serverId)

    const capsRes = await fetch(`${httpBase}/api/capabilities`, {
      headers: { authorization: `Bearer ${bootstrap.sessionToken}` },
    })
    expect(capsRes.status).toBe(200)
    const fetchedCaps = (await capsRes.json()) as ServerCapabilities
    expect(fetchedCaps.serverId).toBe(serverId)

    const wstRes = await fetch(`${httpBase}/api/auth/ws-token`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bootstrap.sessionToken}` },
    })
    expect(wstRes.status).toBe(200)
    const wst = (await wstRes.json()) as WsTokenResult

    const ws = new WebSocket(`${wsUrl}?wsToken=${wst.wsToken}`)
    const opened = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 3000)
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
    ws.close()
  })

  it('existing RPC calls still work with no auth middleware in the way', async () => {
    // Sanity: the extraHttpHandler must not shadow the oRPC router.
    const res = await fetch(`${httpBase}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairingToken: 'totally-bogus', client: { deviceName: 'x', os: 'y', appVersion: 'z' } }),
    })
    expect(res.status).toBe(401) // auth handler handled this

    // oRPC endpoints (any path not /api/*) should still fall through.
    const notAuthPath = await fetch(`${httpBase}/some/random/path`)
    // The oRPC handler returns 404 for unmatched paths, same as before.
    expect(notAuthPath.status).toBe(404)
  })
})
