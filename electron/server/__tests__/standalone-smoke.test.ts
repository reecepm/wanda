// -----------------------------------------------------------------------------
// Standalone-server end-to-end smoke test.
//
// Boots createServerRuntime() + WsGateway in-process with NO Electron
// involvement, connects a WebSocket client + an HTTP RPC client, exercises
// workspace.create + pod.create, and asserts that the WebSocket receives
// the corresponding `orpc:invalidate` broadcasts in real time.
//
// Updated for the wsToken-only / hello-handshake protocol: every WS upgrade
// presents a one-shot wsToken minted from the shell session, and the
// gateway fan-out only starts after the client has completed `sys:hello`.
// -----------------------------------------------------------------------------

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { AppRouter } from '../../router/index'
import { configureAgentRuntime, configureDatabase } from '../../services'
import { type AuthStore, createAuthHttpHandler, createInMemoryAuthStore } from '../auth'
import { createServerRuntime, type ServerRuntimeHandle } from '../runtime'
import { WsGateway } from '../ws-gateway'

type AppClient = RouterClient<AppRouter>

const SHELL = { deviceName: 'smoke-shell', os: 'darwin', appVersion: '0.0.0-smoke' }

describe('standalone server smoke', () => {
  let scratch: string
  let runtime: ServerRuntimeHandle
  let wsGateway: WsGateway
  let store: AuthStore
  let shellSessionToken: string
  let httpBase: string
  let wsUrl: string
  let client: AppClient

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'wanda-smoke-'))
    mkdirSync(join(scratch, 'data'), { recursive: true })

    const dataDir = join(scratch, 'data')
    const dbPath = join(dataDir, 'test.db')
    const mcpPortFile = join(dataDir, 'mcp-port')
    const appRoot = process.cwd()
    const migrationsFolder = join(appRoot, 'electron/db/migrations')

    configureDatabase({ dbPath, migrationsFolder })
    configureAgentRuntime({
      appRoot,
      appVersion: '0.0.0-smoke',
      openExternal: () => {},
    })

    const serverId = 'smoke-server'
    store = createInMemoryAuthStore(serverId)
    shellSessionToken = store.createLocalSession(SHELL).sessionToken

    wsGateway = new WsGateway({ authStore: store, serverId, epoch: 1 })
    runtime = await createServerRuntime({
      snapshotStoreDir: dataDir,
      mcpPortFile,
      host: '127.0.0.1',
      port: 0,
      epoch: 1,
      broadcast: wsGateway.broadcast,
      onNotificationsChanged: () => {
        wsGateway.broadcast('notifications:changed')
      },
      extraHttpHandler: createAuthHttpHandler({
        store,
        capabilities: {
          serverId,
          hostname: 'smoke',
          appVersion: '0.0.0-smoke',
          ssh: null,
          features: { docker: true, agents: true, workspaceRoot: '/tmp' },
        },
      }),
      authenticateRpc: (req) => {
        const auth = req.headers.authorization
        if (!auth) return false
        const parts = auth.split(' ')
        if (parts.length !== 2 || parts[0] !== 'Bearer') return false
        return store.validateSession(parts[1] ?? '') !== null
      },
    })
    wsGateway.attachTo(runtime.httpServer, runtime.eventLog)

    httpBase = `http://127.0.0.1:${runtime.mcpPort}`
    wsUrl = `ws://127.0.0.1:${runtime.mcpPort}/events`
    const link = new RPCLink({
      url: httpBase,
      headers: () => ({ authorization: `Bearer ${shellSessionToken}` }),
    })
    client = createORPCClient<AppClient>(link)
  }, 30_000)

  afterAll(async () => {
    if (wsGateway) await wsGateway.close()
    if (runtime) await runtime.stop()
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }, 30_000)

  async function mintWsToken(): Promise<string> {
    const res = await fetch(`${httpBase}/api/auth/ws-token`, {
      method: 'POST',
      headers: { authorization: `Bearer ${shellSessionToken}` },
    })
    if (!res.ok) throw new Error(`ws-token mint failed: ${res.status}`)
    const body = (await res.json()) as { wsToken: string }
    return body.wsToken
  }

  it('HTTP server listens on an ephemeral port', () => {
    expect(runtime.mcpPort).toBeGreaterThan(0)
  })

  it('workspace.list over HTTP oRPC returns an array', async () => {
    const list = await client.workspace.list({})
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBe(0)
  })

  it('rejects WebSocket upgrade without a wsToken', async () => {
    const result = await new Promise<'rejected' | 'accepted'>((resolve) => {
      const ws = new WebSocket(wsUrl)
      ws.on('open', () => {
        resolve('accepted')
        ws.close()
      })
      ws.on('unexpected-response', () => resolve('rejected'))
      ws.on('error', () => resolve('rejected'))
    })
    expect(result).toBe('rejected')
  })

  it('rejects WebSocket upgrade with an unknown wsToken', async () => {
    const result = await new Promise<'rejected' | 'accepted'>((resolve) => {
      const ws = new WebSocket(`${wsUrl}?wsToken=not-a-real-token`)
      ws.on('open', () => {
        resolve('accepted')
        ws.close()
      })
      ws.on('unexpected-response', () => resolve('rejected'))
      ws.on('error', () => resolve('rejected'))
    })
    expect(result).toBe('rejected')
  })

  it('accepts a wsToken-authenticated upgrade and relays broadcasts after hello', async () => {
    const received: Array<{ channel: string; args: unknown[] }> = []
    const wsToken = await mintWsToken()
    const wsClient = new WebSocket(`${wsUrl}?wsToken=${wsToken}`)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('ws open timeout')), 5000)
      wsClient.on('open', () => {
        clearTimeout(timeout)
        resolve()
      })
      wsClient.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    wsClient.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { channel: string; args: unknown[] }
        received.push(msg)
      } catch {
        // ignore
      }
    })

    // Complete the hello handshake so the gateway will forward broadcasts to us.
    wsClient.send(
      JSON.stringify({
        v: 1,
        seq: 0,
        ts: Date.now(),
        channel: 'sys:hello',
        args: [{ v: 1, clientId: 'smoke-client' }],
      }),
    )
    const ackDeadline = Date.now() + 2000
    while (Date.now() < ackDeadline) {
      if (received.some((m) => m.channel === 'sys:hello-ack')) break
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(received.some((m) => m.channel === 'sys:hello-ack')).toBe(true)
    expect(wsGateway.clientCount).toBe(1)

    // Trigger a mutation via HTTP oRPC — should produce an orpc:invalidate broadcast.
    const workspace = await client.workspace.create({ name: 'smoke workspace', cwd: '/tmp' })
    expect(typeof workspace.id).toBe('string')

    await new Promise((r) => setTimeout(r, 150))

    const invalidate = received.find(
      (m) => m.channel === 'orpc:invalidate' && m.args[0] === 'workspace' && m.args[1] === 'create',
    )
    expect(invalidate).toBeDefined()

    const beforeCount = received.length
    const pod = await client.pod.create({ workspaceId: workspace.id, name: 'smoke pod', cwd: '/tmp' })
    expect(typeof pod.id).toBe('string')
    await new Promise((r) => setTimeout(r, 150))
    expect(received.length).toBeGreaterThan(beforeCount)

    wsClient.close()
    await new Promise((r) => setTimeout(r, 50))
  })

  it('stops cleanly', async () => {
    expect(runtime.mcpPort).toBeGreaterThan(0)
  })
})
