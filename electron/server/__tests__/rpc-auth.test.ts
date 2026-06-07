// -----------------------------------------------------------------------------
// Server HTTP RPC authentication gate.
//
// Spins up createServerRuntime() wired to an authenticateRpc callback that
// mirrors bin.ts — every caller must present an AuthStore-issued session
// token, whether it's the locally-minted shell session or a paired client's
// bootstrap result. Hits the oRPC endpoint with various Authorization
// headers and asserts status codes.
// -----------------------------------------------------------------------------

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { configureAgentRuntime, configureDatabase } from '../../services'
import { createAuthHttpHandler, createInMemoryAuthStore } from '../auth'
import { createServerRuntime, type ServerRuntimeHandle } from '../runtime'

const CLIENT_INFO = { deviceName: 'rpc-auth-client', os: 'darwin', appVersion: '0.0.0-rpc-auth' }
const LOCAL_SHELL_INFO = { deviceName: 'rpc-auth-shell', os: 'darwin', appVersion: '0.0.0-rpc-auth' }

describe('server HTTP RPC auth gate', () => {
  let scratch: string
  let runtime: ServerRuntimeHandle
  let httpBase: string
  let localSessionToken: string
  let store: ReturnType<typeof createInMemoryAuthStore>

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'wanda-rpc-auth-'))
    mkdirSync(join(scratch, 'data'), { recursive: true })
    const dataDir = join(scratch, 'data')
    const appRoot = process.cwd()

    configureDatabase({
      dbPath: join(dataDir, 'test.db'),
      migrationsFolder: join(appRoot, 'electron/db/migrations'),
    })
    configureAgentRuntime({ appRoot, appVersion: '0.0.0-rpc-auth', openExternal: () => {} })

    store = createInMemoryAuthStore('rpc-auth-server')
    localSessionToken = store.createLocalSession(LOCAL_SHELL_INFO).sessionToken

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
          serverId: 'rpc-auth-server',
          hostname: 'test',
          appVersion: '0.0.0-rpc-auth',
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
        return store.validateSession(provided) !== null
      },
    })

    httpBase = `http://127.0.0.1:${runtime.mcpPort}`
  }, 30_000)

  afterAll(async () => {
    if (runtime) await runtime.stop()
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }, 30_000)

  async function callRpc(path: string[], input: unknown, token: string | null): Promise<Response> {
    return fetch(`${httpBase}/${path.join('/')}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ json: input }),
    })
  }

  it('rejects RPC calls with no Authorization header (401)', async () => {
    const res = await callRpc(['workspace', 'list'], {}, null)
    expect(res.status).toBe(401)
  })

  it('rejects RPC calls with a bogus bearer token (401)', async () => {
    const res = await callRpc(['workspace', 'list'], {}, 'totally-wrong')
    expect(res.status).toBe(401)
  })

  it('accepts RPC calls signed with the local shell session token (200)', async () => {
    const res = await callRpc(['workspace', 'list'], {}, localSessionToken)
    expect(res.status).toBe(200)
  })

  it('accepts RPC calls signed with a session token issued via pairing', async () => {
    const pairing = store.createPairingToken()
    const bootstrap = store.consumePairingToken(pairing.token, CLIENT_INFO)!
    const res = await callRpc(['workspace', 'list'], {}, bootstrap.sessionToken)
    expect(res.status).toBe(200)
  })

  it('rejects RPC after a session is revoked', async () => {
    const pairing = store.createPairingToken()
    const bootstrap = store.consumePairingToken(pairing.token, CLIENT_INFO)!
    const ok = await callRpc(['workspace', 'list'], {}, bootstrap.sessionToken)
    expect(ok.status).toBe(200)

    store.revokeSession(bootstrap.sessionId)

    const nope = await callRpc(['workspace', 'list'], {}, bootstrap.sessionToken)
    expect(nope.status).toBe(401)
  })

  it('still serves /api/auth/* without auth (auth endpoints are the bootstrap)', async () => {
    const res = await fetch(`${httpBase}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairingToken: 'bogus', client: CLIENT_INFO }),
    })
    // 401 here comes from the auth handler itself rejecting the bogus token,
    // NOT from the RPC gate. The important thing is we got PAST the gate.
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe('invalid-or-expired-pairing-token')
  })
})
