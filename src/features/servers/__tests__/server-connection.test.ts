// PairedServerClient integration tests.
//
// Spins up a real `createServerRuntime()` with bin.ts-equivalent auth
// wiring, pairs against it, and verifies the renderer-side client can
// call real RPC methods with session-token auth.

import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAuthHttpHandler, createInMemoryAuthStore } from '../../../../electron/server/auth'
import { createServerRuntime, type ServerRuntimeHandle } from '../../../../electron/server/runtime'
import { configureAgentRuntime, configureDatabase } from '../../../../electron/services'
import { createPairedServerClient } from '../server-connection'

const CLIENT_INFO = { deviceName: 'conn-client', os: 'darwin', appVersion: '0.0.0-conn' }

describe('createPairedServerClient against a live server', () => {
  let scratch: string
  let runtime: ServerRuntimeHandle
  let httpBase: string
  let staticToken: string
  let store: ReturnType<typeof createInMemoryAuthStore>

  function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let m = 0
    for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return m === 0
  }

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'wanda-conn-'))
    mkdirSync(join(scratch, 'data'), { recursive: true })
    const dataDir = join(scratch, 'data')
    const appRoot = process.cwd()
    staticToken = randomBytes(32).toString('hex')

    configureDatabase({
      dbPath: join(dataDir, 'test.db'),
      migrationsFolder: join(appRoot, 'electron/db/migrations'),
    })
    configureAgentRuntime({ appRoot, appVersion: '0.0.0-conn', openExternal: () => {} })

    store = createInMemoryAuthStore('conn-server')
    runtime = await createServerRuntime({
      snapshotStoreDir: dataDir,
      mcpPortFile: join(dataDir, 'mcp-port'),
      host: '127.0.0.1',
      port: 0,
      epoch: 1,
      broadcast: () => {},
      onNotificationsChanged: () => {},
      extraHttpHandler: createAuthHttpHandler({
        store,
        capabilities: {
          serverId: 'conn-server',
          hostname: 'conn',
          appVersion: '0.0.0-conn',
          ssh: null,
          features: { docker: true, agents: true, workspaceRoot: '/tmp' },
        },
      }),
      authenticateRpc: (req) => {
        const auth = req.headers.authorization
        if (!auth) return false
        const parts = auth.split(' ')
        if (parts.length !== 2 || parts[0] !== 'Bearer') return false
        const provided = parts[1] ?? ''
        if (safeEqual(provided, staticToken)) return true
        return store.validateSession(provided) !== null
      },
    })

    httpBase = `http://127.0.0.1:${runtime.mcpPort}`
  }, 30_000)

  afterAll(async () => {
    if (runtime) await runtime.stop()
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }, 30_000)

  it('calls a real RPC method with a paired session token', async () => {
    const pairing = store.createPairingToken()
    const bootstrap = store.consumePairingToken(pairing.token, CLIENT_INFO)!
    const { client } = createPairedServerClient({
      baseUrl: httpBase,
      sessionToken: bootstrap.sessionToken,
    })
    const list = await client.workspace.list({})
    expect(Array.isArray(list)).toBe(true)
  })

  it('rejects with an unauthorized error when the session is revoked', async () => {
    const pairing = store.createPairingToken()
    const bootstrap = store.consumePairingToken(pairing.token, CLIENT_INFO)!
    const { client } = createPairedServerClient({
      baseUrl: httpBase,
      sessionToken: bootstrap.sessionToken,
    })
    // Works initially.
    await client.workspace.list({})
    store.revokeSession(bootstrap.sessionId)
    // Now rejects.
    await expect(client.workspace.list({})).rejects.toBeDefined()
  })

  it('setSessionToken swaps the token in place (no new client needed)', async () => {
    const p1 = store.createPairingToken()
    const b1 = store.consumePairingToken(p1.token, CLIENT_INFO)!
    const conn = createPairedServerClient({
      baseUrl: httpBase,
      sessionToken: b1.sessionToken,
    })

    await conn.client.workspace.list({})
    store.revokeSession(b1.sessionId)
    await expect(conn.client.workspace.list({})).rejects.toBeDefined()

    // Re-pair and swap the token in place; same client handle, new auth.
    const p2 = store.createPairingToken()
    const b2 = store.consumePairingToken(p2.token, CLIENT_INFO)!
    conn.setSessionToken(b2.sessionToken)

    const list = await conn.client.workspace.list({})
    expect(Array.isArray(list)).toBe(true)
  })
})
