// -----------------------------------------------------------------------------
// Full paired-client user-journey test.
//
// Stitches together every piece the Electron app uses when a user pairs
// into a remote server and then drives it from their laptop:
//
//   • Server runtime (createServerRuntime) — the real RPC + WS surface
//     of the *remote* machine.
//   • Client-side SQLite (ClientDb) — persists paired-server metadata.
//   • Client-side SecretStore — AES encryption of session tokens.
//   • ServerRegistry — main-process facade that owns pair/remove/list,
//     holds encrypted session tokens, and mints ws-tokens.
//   • An oRPC RPCLink built from the registry's stored credentials, the
//     same way `src/features/servers/server-connection.ts` does in the
//     renderer.
//
// If these tests pass, the pairing + remote-drive code paths are known-
// good end-to-end. Anything the user sees that contradicts these results
// is by elimination a frontend wiring bug.
//
// Every test uses fresh pairing/registry state so they don't share hidden
// coupling via the session store.
// -----------------------------------------------------------------------------

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { ServerCapabilities } from '../../../shared/contracts/capabilities'
import { configureSecretStore, type SecretStore } from '../../infra/secret-store'
import type { AppRouter } from '../../router/index'
import { AppRuntime, configureAgentRuntime, configureDatabase, DatabaseService } from '../../services'
import { type ClientDb, createClientDb } from '../../shell/client-db'
import { createServerRegistry, type ServerRegistry } from '../../shell/server-registry'
import { type AuthStore, createAuthHttpHandler, createInMemoryAuthStore } from '../auth'
import { createServerRuntime, type ServerRuntimeHandle } from '../runtime'
import { WsGateway } from '../ws-gateway'

type AppClient = RouterClient<AppRouter>

const CLIENT_INFO = { deviceName: 'journey-laptop', os: 'darwin', appVersion: '0.0.0-journey' }

const CAPS: ServerCapabilities = {
  serverId: 'srv-journey',
  hostname: 'server-journey',
  appVersion: '0.0.0-journey',
  ssh: { host: 'journey.tailnet', user: 'user', port: 22, workspacePath: '/tmp/ws' },
  features: { docker: true, agents: true, workspaceRoot: '/tmp/ws' },
}

/** Test-only SecretStore: base64 with the canonical `wse1:` prefix. The
 *  prefix is what `decryptSecret` checks for before delegating to
 *  `store.decrypt` — using any other prefix makes the wrapper treat the
 *  ciphertext as legacy plaintext and skip decryption entirely. */
function makeTestSecretStore(): SecretStore {
  return {
    encrypt: (s) => `wse1:${Buffer.from(s, 'utf8').toString('base64')}`,
    decrypt: (s) => Buffer.from(s.slice(5), 'base64').toString('utf8'),
  }
}

interface WsEnvelope {
  v: 1
  seq: number
  ts: number
  channel: string
  args: unknown[]
}

describe('paired-client full user journey', () => {
  let scratch: string
  let runtime: ServerRuntimeHandle
  let wsGateway: WsGateway
  let store: AuthStore
  let baseUrl: string
  let wsUrl: string
  let shellSessionToken: string
  let clientDb: ClientDb
  let registry: ServerRegistry

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'wanda-journey-'))
    mkdirSync(join(scratch, 'data'), { recursive: true })
    const dataDir = join(scratch, 'data')
    const appRoot = process.cwd()

    configureDatabase({
      dbPath: join(dataDir, 'server.db'),
      migrationsFolder: join(appRoot, 'electron/db/migrations'),
    })
    configureAgentRuntime({ appRoot, appVersion: '0.0.0-journey', openExternal: () => {} })
    configureSecretStore(makeTestSecretStore())

    const db = await AppRuntime.runPromise(DatabaseService)
    store = createInMemoryAuthStore(CAPS.serverId, { db })
    const authHandler = createAuthHttpHandler({ store, capabilities: CAPS })
    shellSessionToken = store.createLocalSession({
      deviceName: 'journey-shell',
      os: 'darwin',
      appVersion: '0.0.0-journey',
    }).sessionToken

    wsGateway = new WsGateway({
      authStore: store,
      serverId: CAPS.serverId,
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
      authenticateRpc: (req) => {
        const auth = req.headers.authorization
        if (!auth) return false
        const parts = auth.split(' ')
        if (parts.length !== 2 || parts[0] !== 'Bearer') return false
        const provided = parts[1] ?? ''
        return store.validateSession(provided) !== null
      },
      onNotificationsChanged: () => {
        wsGateway.broadcast('notifications:changed')
      },
    })
    wsGateway.attachTo(runtime.httpServer, runtime.eventLog)

    baseUrl = `http://127.0.0.1:${runtime.mcpPort}`
    wsUrl = `ws://127.0.0.1:${runtime.mcpPort}/events`

    clientDb = createClientDb(join(scratch, 'client.db'))
    registry = createServerRegistry({ db: clientDb, clientInfo: CLIENT_INFO })
  }, 45_000)

  afterAll(async () => {
    if (wsGateway) await wsGateway.close()
    if (runtime) await runtime.stop()
    if (clientDb) clientDb.close()
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }, 30_000)

  /** Build the RPC client the way src/features/servers/server-connection.ts does. */
  function rpcClientForPaired(id: string): AppClient {
    const token = registry.getSessionToken(id)
    if (!token) throw new Error(`no session token cached for paired server ${id}`)
    const paired = registry.list().find((s) => s.id === id)
    if (!paired) throw new Error(`unknown paired server: ${id}`)
    const link = new RPCLink({
      url: paired.baseUrl,
      headers: () => ({ authorization: `Bearer ${token}` }),
    })
    return createORPCClient<AppClient>(link)
  }

  async function pairViaRegistry(_label: string): Promise<{ id: string }> {
    const p = store.createPairingToken()
    const url = `${baseUrl}/pair#token=${p.token}`
    const paired = await registry.pair(url)
    expect(paired.serverId).toBe(CAPS.serverId)
    // Label comes from capabilities.hostname.
    expect(paired.label).toBe(CAPS.hostname)
    expect(paired.baseUrl).toBe(baseUrl)
    return { id: paired.id }
  }

  // ---------------------------------------------------------------------------
  // The top-of-funnel pairing flow — one call does bootstrap +
  // capabilities + encrypted persist.
  // ---------------------------------------------------------------------------

  it('registry.pair persists capabilities-derived label and stores the session encrypted', async () => {
    const { id } = await pairViaRegistry('first')

    // Label was fetched via /api/capabilities and stored.
    const list = registry.list()
    expect(list.some((s) => s.id === id && s.label === CAPS.hostname)).toBe(true)

    // Raw ciphertext in the DB must not contain the plaintext token.
    const raw = clientDb.getRawSessionTokenCiphertext(id)
    expect(raw).toBeTruthy()
    expect(raw!.startsWith('wse1:')).toBe(true)
    // Roundtrip through the registry yields a plausible session token.
    const plain = registry.getSessionToken(id)
    expect(plain?.length ?? 0).toBeGreaterThan(32)

    registry.remove(id)
  })

  // ---------------------------------------------------------------------------
  // The "read-only" Machines-page workflow: pair + list inventory.
  // ---------------------------------------------------------------------------

  it('a fresh paired client can list workspaces + pods through the RPC link', async () => {
    const { id } = await pairViaRegistry('inventory')

    // Seed some state on the remote BEFORE the paired client reads it,
    // to match "other machine already had pods/workspaces" scenario.
    const seedLink = new RPCLink({
      url: baseUrl,
      headers: () => ({ authorization: `Bearer ${shellSessionToken}` }),
    })
    const seed = createORPCClient<AppClient>(seedLink)
    const seededWs = (await seed.workspace.create({
      name: 'inventory-ws',
      cwd: '/tmp/inventory-ws',
    })) as { id: string }
    const seededPod = (await seed.pod.create({
      workspaceId: seededWs.id,
      name: 'inventory-pod',
      cwd: '/tmp/inventory-ws',
    })) as { id: string }

    // Now ask through the paired RPC link — what the renderer does.
    const paired = rpcClientForPaired(id)
    const workspaces = (await paired.workspace.list({})) as Array<{ id: string; name: string }>
    expect(workspaces.some((w) => w.id === seededWs.id)).toBe(true)

    const pods = (await paired.pod.list({ workspaceId: seededWs.id })) as Array<{ id: string }>
    expect(pods.some((p) => p.id === seededPod.id)).toBe(true)

    // Cleanup + unpair.
    await paired.pod.delete({ id: seededPod.id })
    await paired.workspace.delete({ id: seededWs.id })
    registry.remove(id)
  })

  // ---------------------------------------------------------------------------
  // Mutation workflow: paired client creates/modifies remote state.
  // ---------------------------------------------------------------------------

  it('a paired client can mutate the remote (create pod, add terminal, delete) through the RPC link', async () => {
    const { id } = await pairViaRegistry('mutation')
    const paired = rpcClientForPaired(id)

    const ws = (await paired.workspace.create({
      name: 'mutation-ws',
      cwd: '/tmp/mutation-ws',
    })) as { id: string }

    const pod = (await paired.pod.create({
      workspaceId: ws.id,
      name: 'mutation-pod',
      cwd: '/tmp/mutation-ws',
    })) as { id: string }

    const term = (await paired.pod.addTerminal({ podId: pod.id, name: 'shell' })) as { id: string }
    const terms = (await paired.pod.listTerminals({ podId: pod.id })) as Array<{ id: string }>
    expect(terms.some((t) => t.id === term.id)).toBe(true)

    await paired.pod.removeTerminal({ id: term.id })
    await paired.pod.delete({ id: pod.id })
    await paired.workspace.delete({ id: ws.id })

    registry.remove(id)
  })

  // ---------------------------------------------------------------------------
  // WS journey: registry mints ws-token, client opens /events, receives
  // invalidates for remote mutations.
  // ---------------------------------------------------------------------------

  it('registry issues a ws-token that opens /events and delivers live invalidates', async () => {
    const { id } = await pairViaRegistry('ws-journey')
    const paired = rpcClientForPaired(id)

    const wst = await registry.issueWsToken(id)
    expect(wst.wsToken).toBeTruthy()

    const received: WsEnvelope[] = []
    const ws = new WebSocket(`${wsUrl}?wsToken=${wst.wsToken}`)
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws open timeout')), 5000)
      ws.once('open', () => {
        clearTimeout(t)
        resolve()
      })
      ws.once('error', (err) => {
        clearTimeout(t)
        reject(err)
      })
    })
    ws.on('message', (raw) => {
      try {
        received.push(JSON.parse(raw.toString()))
      } catch {
        /* ignore */
      }
    })
    // Post-hello handshake so the gateway starts fan-out to this socket.
    ws.send(
      JSON.stringify({
        v: 1,
        seq: 0,
        ts: Date.now(),
        channel: 'sys:hello',
        args: [{ v: 1, clientId: 'journey-test' }],
      }),
    )
    const ackDeadline = Date.now() + 2000
    while (Date.now() < ackDeadline) {
      if (received.some((e) => e.channel === 'sys:hello-ack')) break
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(received.some((e) => e.channel === 'sys:hello-ack')).toBe(true)

    const created = (await paired.workspace.create({
      name: 'live-journey',
      cwd: '/tmp/live-journey',
    })) as { id: string }

    // Wait briefly for the broadcast.
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      if (
        received.some((e) => e.channel === 'orpc:invalidate' && e.args[0] === 'workspace' && e.args[1] === 'create')
      ) {
        break
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(
      received.some((e) => e.channel === 'orpc:invalidate' && e.args[0] === 'workspace' && e.args[1] === 'create'),
    ).toBe(true)

    await paired.workspace.delete({ id: created.id })
    ws.close()
    await new Promise((r) => setTimeout(r, 50))

    registry.remove(id)
  })

  // ---------------------------------------------------------------------------
  // Registry lifecycle: re-open persisted DB, session token survives.
  // ---------------------------------------------------------------------------

  it('client registry survives a main-process "restart" (close + reopen DB, session still works against the live runtime)', async () => {
    const { id } = await pairViaRegistry('restart')

    // Prove it works pre-restart.
    let paired = rpcClientForPaired(id)
    await paired.workspace.list({})

    // "Restart": close the client DB, reopen it, build a fresh registry.
    const dbPath = join(scratch, 'client.db')
    clientDb.close()
    clientDb = createClientDb(dbPath)
    registry = createServerRegistry({ db: clientDb, clientInfo: CLIENT_INFO })

    const list = registry.list()
    expect(list.some((s) => s.id === id)).toBe(true)

    // Call through the fresh registry + RPCLink — still works because
    // (a) the client DB kept the encrypted token and (b) the server's
    // SQLite-backed AuthStore kept the session valid.
    paired = rpcClientForPaired(id)
    await paired.workspace.list({})

    registry.remove(id)
  })

  // ---------------------------------------------------------------------------
  // Failure case: remote revokes the session; subsequent calls fail.
  // ---------------------------------------------------------------------------

  it('if the remote revokes the session, the registry-built RPC client fails', async () => {
    const { id } = await pairViaRegistry('revocation')
    const paired = rpcClientForPaired(id)

    // Works initially.
    await paired.workspace.list({})

    // Find THIS test's session specifically. Earlier tests left sessions
    // behind under the same deviceName, so filter + pick most recent.
    const token = registry.getSessionToken(id)
    expect(token).toBeTruthy()
    const validated = store.validateSession(token!)
    expect(validated).not.toBeNull()
    expect(store.revokeSession(validated!.sessionId)).toBe(true)

    await expect(paired.workspace.list({})).rejects.toThrow()

    // Re-pairing with a new token restores access.
    const nextPair = store.createPairingToken()
    const repaired = await registry.pair(`${baseUrl}/pair#token=${nextPair.token}`)
    const repairedClient = rpcClientForPaired(repaired.id)
    await repairedClient.workspace.list({})

    registry.remove(id)
    registry.remove(repaired.id)
  })

  // ---------------------------------------------------------------------------
  // Remove propagation.
  // ---------------------------------------------------------------------------

  it('registry.remove drops the entry AND forgets the stored session token', async () => {
    const { id } = await pairViaRegistry('remove')
    expect(registry.getSessionToken(id)).toBeTruthy()
    registry.remove(id)
    expect(registry.list().some((s) => s.id === id)).toBe(false)
    expect(registry.getSessionToken(id)).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // Multiple independent pairings under one client.
  // ---------------------------------------------------------------------------

  // Re-pair into the same server is a legitimate flow (rotate credentials,
  // recover from lost session). Registry should replace the previous row
  // rather than crashing on the UNIQUE(server_id) constraint in client.db.
  it('pairing a second time to the same server replaces the previous entry and credential', async () => {
    const first = await pairViaRegistry('repair-initial')
    const firstToken = registry.getSessionToken(first.id)
    expect(firstToken).toBeTruthy()

    // First client works.
    let client = rpcClientForPaired(first.id)
    await client.workspace.list({})

    // Second pair to the same server — new uuid row, fresh session token,
    // old row gone from the client DB.
    const second = await pairViaRegistry('repair-second')
    expect(second.id).not.toBe(first.id)
    expect(registry.list().some((r) => r.id === first.id)).toBe(false)
    const secondToken = registry.getSessionToken(second.id)
    expect(secondToken).toBeTruthy()
    expect(secondToken).not.toBe(firstToken)

    // New client works; old one (if anyone kept a reference) continues to
    // work too because we don't proactively revoke on the remote — the
    // old session just ages out naturally.
    client = rpcClientForPaired(second.id)
    await client.workspace.list({})

    registry.remove(second.id)
  })
})
