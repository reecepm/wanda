// -----------------------------------------------------------------------------
// Cross-server pairing end-to-end test.
//
// Mirrors the exact Machines-page flow a user goes through:
//
//   1. Server B (the "remote") creates a pairing token.
//   2. Client A POSTs /api/auth/bootstrap with that token → gets a session.
//   3. Client A builds an oRPC RPCLink using the session token, exactly the
//      way `src/features/servers/server-connection.ts` does.
//   4. Client A calls `workspace.list({})` against server B and sees the
//      workspace server B created before pairing.
//   5. Client A calls `workspace.create({...})` through the RPCLink →
//      the new workspace lands in server B's DB and is visible on the
//      next list call.
//   6. Capabilities + WS-token flow work and revoking the session makes
//      subsequent RPCs fail with 401.
//
// This is the test that would have caught "paired but see nothing on the
// other machine" if the bug were code-level. It runs against one real
// `createServerRuntime()` (server B) and simulates client A purely with
// fetch + RPCLink — which is exactly how the renderer talks to a paired
// remote, so the call shape matches production.
// -----------------------------------------------------------------------------

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { BootstrapResult, WsTokenResult } from '../../../shared/contracts/auth'
import type { ServerCapabilities } from '../../../shared/contracts/capabilities'
import type { AppRouter } from '../../router/index'
import { AppRuntime, configureAgentRuntime, configureDatabase, DatabaseService } from '../../services'
import { type AuthStore, createAuthHttpHandler, createInMemoryAuthStore } from '../auth'
import { createServerRuntime, type ServerRuntimeHandle } from '../runtime'
import { WsGateway } from '../ws-gateway'

type AppClient = RouterClient<AppRouter>

const CAPS: ServerCapabilities = {
  serverId: 'srv-B',
  hostname: 'server-b',
  appVersion: '0.0.0-xpair',
  ssh: { host: 'server-b.tailnet', user: 'user', port: 22, workspacePath: '/tmp/ws' },
  features: { docker: true, agents: true, workspaceRoot: '/tmp/ws' },
}

/**
 * Client A's shell — what a renderer sees when it wants to talk to a
 * paired remote. Holds the session token + an oRPC client pointed at
 * server B's baseUrl.
 */
interface PairedClient {
  sessionToken: string
  sessionId: string
  client: AppClient
  capabilities: () => Promise<ServerCapabilities>
  issueWsToken: () => Promise<WsTokenResult>
}

async function pairClientInto(baseUrl: string, pairingToken: string): Promise<PairedClient> {
  const res = await fetch(`${baseUrl}/api/auth/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pairingToken,
      client: { deviceName: 'laptop-A', os: 'darwin', appVersion: '0.0.0-xpair' },
    }),
  })
  if (res.status !== 200) throw new Error(`bootstrap failed: ${res.status} ${await res.text()}`)
  const bootstrap = (await res.json()) as BootstrapResult

  let token = bootstrap.sessionToken
  const link = new RPCLink({
    url: baseUrl,
    headers: () => ({ authorization: `Bearer ${token}` }),
  })
  const client = createORPCClient<AppClient>(link)

  return {
    get sessionToken() {
      return token
    },
    set sessionToken(next: string) {
      token = next
    },
    sessionId: bootstrap.sessionId,
    client,
    async capabilities() {
      const r = await fetch(`${baseUrl}/api/capabilities`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (r.status !== 200) throw new Error(`capabilities failed: ${r.status}`)
      return (await r.json()) as ServerCapabilities
    },
    async issueWsToken() {
      const r = await fetch(`${baseUrl}/api/auth/ws-token`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      if (r.status !== 200) throw new Error(`ws-token failed: ${r.status}`)
      return (await r.json()) as WsTokenResult
    },
  } as PairedClient
}

describe('cross-server pairing end-to-end', () => {
  let scratch: string
  let runtime: ServerRuntimeHandle
  let wsGateway: WsGateway
  let store: AuthStore
  let baseUrl: string
  let wsUrl: string
  let shellSessionToken: string
  /** Workspace server B creates pre-pairing — client A must see it on list. */
  let seededWorkspaceId: string

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'wanda-xpair-'))
    mkdirSync(join(scratch, 'data'), { recursive: true })
    const dataDir = join(scratch, 'data')
    const appRoot = process.cwd()

    configureDatabase({
      dbPath: join(dataDir, 'test.db'),
      migrationsFolder: join(appRoot, 'electron/db/migrations'),
    })
    configureAgentRuntime({ appRoot, appVersion: '0.0.0-xpair', openExternal: () => {} })

    const db = await AppRuntime.runPromise(DatabaseService)
    store = createInMemoryAuthStore(CAPS.serverId, {
      db,
    })
    const authHandler = createAuthHttpHandler({ store, capabilities: CAPS })
    shellSessionToken = store.createLocalSession({
      deviceName: 'xpair-shell',
      os: 'darwin',
      appVersion: '0.0.0-xpair',
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

    // Seed a workspace on server B using the shell session token — this
    // simulates "server B had existing work before anyone paired into it".
    const seedLink = new RPCLink({
      url: baseUrl,
      headers: () => ({ authorization: `Bearer ${shellSessionToken}` }),
    })
    const seedClient = createORPCClient<AppClient>(seedLink)
    const seeded = await seedClient.workspace.create({ name: 'server-b seed', cwd: '/tmp/seed' })
    seededWorkspaceId = seeded.id
  }, 30_000)

  afterAll(async () => {
    if (wsGateway) await wsGateway.close()
    if (runtime) await runtime.stop()
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }, 30_000)

  it('client A can pair, then list workspaces from server B', async () => {
    const pairing = store.createPairingToken()
    const a = await pairClientInto(baseUrl, pairing.token)

    expect(a.sessionToken).toBeTruthy()
    expect(a.sessionId).toBeTruthy()

    const caps = await a.capabilities()
    expect(caps.serverId).toBe(CAPS.serverId)
    expect(caps.ssh?.host).toBe('server-b.tailnet')

    // The Machines page query — `workspace.list({})`. Must surface the
    // seeded workspace from server B, not the (empty) client A side.
    const workspaces = (await a.client.workspace.list({})) as Array<{ id: string; name: string }>
    expect(workspaces.some((w) => w.id === seededWorkspaceId)).toBe(true)
  })

  it('client A can create workspaces on server B via the paired RPC client', async () => {
    const pairing = store.createPairingToken()
    const a = await pairClientInto(baseUrl, pairing.token)

    const created = (await a.client.workspace.create({
      name: 'created-from-A',
      cwd: '/tmp/from-A',
    })) as { id: string; name: string }
    expect(created.name).toBe('created-from-A')

    // Round-trip: the new workspace shows up on the next list call.
    const workspaces = (await a.client.workspace.list({})) as Array<{ id: string; name: string }>
    expect(workspaces.some((w) => w.id === created.id)).toBe(true)
  })

  it('pods on server B appear when queried through the paired RPC client', async () => {
    const pairing = store.createPairingToken()
    const a = await pairClientInto(baseUrl, pairing.token)

    const ws = (await a.client.workspace.create({
      name: 'pod-host',
      cwd: '/tmp/pod-host',
    })) as { id: string }
    const pod = (await a.client.pod.create({
      workspaceId: ws.id,
      name: 'pod-on-B',
      cwd: '/tmp/pod-on-B',
    })) as { id: string; workspaceId: string }

    // pod.list is workspace-scoped on the server — the Machines page now
    // fans out across workspaces to build a cross-machine pod inventory.
    // This test mirrors that fan-out exactly.
    const workspaces = (await a.client.workspace.list({})) as Array<{ id: string }>
    const perWorkspace = await Promise.all(
      workspaces.map((w) => a.client.pod.list({ workspaceId: w.id }) as Promise<Array<{ id: string }>>),
    )
    const allPods = perWorkspace.flat()
    expect(allPods.some((p) => p.id === pod.id)).toBe(true)
  })

  it('revoking a session invalidates further RPC calls from client A', async () => {
    const pairing = store.createPairingToken()
    const a = await pairClientInto(baseUrl, pairing.token)

    // Sanity: works first.
    await a.client.workspace.list({})

    // Server B revokes the session (e.g. from the "Paired in" UI).
    const revoked = store.revokeSession(a.sessionId)
    expect(revoked).toBe(true)

    // The next RPC call must fail with 401-equivalent. oRPC surfaces it
    // as a thrown error — the exact shape isn't important, just that it
    // doesn't silently succeed.
    await expect(a.client.workspace.list({})).rejects.toThrow()
  })

  it('paired client opens WS via a one-shot ws-token and receives remote broadcasts', async () => {
    const pairing = store.createPairingToken()
    const a = await pairClientInto(baseUrl, pairing.token)

    const wst = await a.issueWsToken()
    expect(wst.wsToken).toBeTruthy()

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

    // Drive a mutation on server B — the WS must relay the invalidate.
    const received: Array<{ channel: string; args: unknown[] }> = []
    ws.on('message', (raw) => {
      try {
        received.push(JSON.parse(raw.toString()))
      } catch {
        // ignore
      }
    })

    ws.send(
      JSON.stringify({
        v: 1,
        seq: 0,
        ts: Date.now(),
        channel: 'sys:hello',
        args: [{ v: 1, clientId: 'test-paired-ws' }],
      }),
    )
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('sys:hello-ack timeout')), 3000)
      const iv = setInterval(() => {
        if (received.some((m) => m.channel === 'sys:hello-ack')) {
          clearInterval(iv)
          clearTimeout(t)
          resolve()
        }
      }, 20)
    })

    await a.client.workspace.create({ name: 'broadcast-trigger', cwd: '/tmp/bc' })
    await new Promise((r) => setTimeout(r, 200))

    const invalidate = received.find(
      (m) => m.channel === 'orpc:invalidate' && m.args[0] === 'workspace' && m.args[1] === 'create',
    )
    expect(invalidate).toBeDefined()

    ws.close()
  })

  it('a wrong pairing token fails bootstrap without touching the session store', async () => {
    const before = store.listSessions().length
    const res = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pairingToken: 'totally-invalid',
        client: { deviceName: 'bad-actor', os: 'linux', appVersion: '0.0.0' },
      }),
    })
    expect(res.status).toBe(401)
    expect(store.listSessions().length).toBe(before)
  })

  it('pairing tokens are single-use', async () => {
    const pairing = store.createPairingToken()
    await pairClientInto(baseUrl, pairing.token)

    // Second attempt with the same token must fail.
    await expect(pairClientInto(baseUrl, pairing.token)).rejects.toThrow()
  })

  it('listing incoming sessions reflects every successful pair', async () => {
    const sizeBefore = store.listSessions().length
    const pairing = store.createPairingToken()
    const a = await pairClientInto(baseUrl, pairing.token)

    const sessions = store.listSessions()
    expect(sessions.length).toBe(sizeBefore + 1)
    const mine = sessions.find((s) => s.sessionId === a.sessionId)
    expect(mine).toBeDefined()
    expect(mine?.device.deviceName).toBe('laptop-A')
  })

  // Regression: "I paired but see 0 workspaces on the other machine after a
  // restart". The in-memory AuthStore used to wipe on boot, so every
  // session token was silently invalid after a restart. With SQLite
  // persistence, a fresh AuthStore must be able to hydrate existing
  // sessions from the same DB and accept the old session token.
  it('sessions survive a server restart via SQLite persistence', async () => {
    const pairing = store.createPairingToken()
    const a = await pairClientInto(baseUrl, pairing.token)

    // Sanity: works before "restart".
    const before = (await a.client.workspace.list({})) as Array<{ id: string }>
    expect(Array.isArray(before)).toBe(true)

    // Simulate a restart: build a brand-new AuthStore against the same DB.
    // Persistence layer must load the existing session into memory so the
    // previously-issued session token keeps validating.
    const db = await AppRuntime.runPromise(DatabaseService)
    const freshStore = createInMemoryAuthStore(CAPS.serverId, {
      db,
    })
    const hydrated = freshStore.validateSession(a.sessionToken)
    expect(hydrated).not.toBeNull()
    expect(hydrated?.sessionId).toBe(a.sessionId)

    // Listing via the fresh store should include the pre-restart session.
    const rehydrated = freshStore.listSessions()
    expect(rehydrated.some((s) => s.sessionId === a.sessionId)).toBe(true)
  })
})
