// -----------------------------------------------------------------------------
// Cross-pairing end-to-end lifecycle suite.
//
// The atomic auth/pairing tests live in `cross-pairing.test.ts`. This file
// stress-tests the full user-visible surfaces a paired client interacts
// with day-to-day:
//
//   • Workspace CRUD via the paired RPC client, visible to local + paired
//   • Pod CRUD (create/rename/update/delete), visible across sessions
//   • Pod terminal lifecycle (add/update/remove/list)
//   • Settings set/get/getMany round-trips
//   • Pairing persistence across a simulated server restart (same DB,
//     fresh AuthStore) so paired inventories survive reboots
//   • Session revocation denies subsequent RPCs
//   • Live broadcast delivery: paired WS clients receive `orpc:invalidate`
//     envelopes for mutations performed over their own HTTP RPC
//   • Multi-client fan-out: two paired clients both receive broadcasts
//     from any mutation on the shared server
//   • WS reconnect + replay: a paired client that disconnects during
//     mutations gets the missed envelopes back on reconnect via
//     `sys:replay-from`
//
// Uses ONE real `createServerRuntime()` (the shared singleton constraint
// from AppRuntime); clients are simulated with fetch + RPCLink +
// `ws` — identical shape to what the renderer actually does in the app.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
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
  serverId: 'srv-lifecycle',
  hostname: 'server-b',
  appVersion: '0.0.0-life',
  ssh: null,
  features: { docker: true, agents: true, workspaceRoot: '/tmp/ws' },
}

// Envelope shape on the wire. Matches electron/server/ws-gateway.ts.
interface WsEnvelope {
  v: 1
  seq: number
  channel: string
  args: unknown[]
}

// -----------------------------------------------------------------------------
// Client-A simulator — what the renderer looks like to the server.
// -----------------------------------------------------------------------------

interface PairedClient {
  sessionToken: string
  sessionId: string
  client: AppClient
  capabilities: () => Promise<ServerCapabilities>
  issueWsToken: () => Promise<WsTokenResult>
  /** Open a /events WebSocket using a freshly-issued one-shot ws-token. */
  openWs: (opts?: { replayFrom?: number }) => Promise<{
    ws: WebSocket
    received: WsEnvelope[]
    onEnvelope: (cb: (env: WsEnvelope) => void) => () => void
  }>
}

async function pairClientInto(
  baseUrl: string,
  wsBaseUrl: string,
  pairingToken: string,
  deviceName: string,
): Promise<PairedClient> {
  const res = await fetch(`${baseUrl}/api/auth/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pairingToken,
      client: { deviceName, os: 'darwin', appVersion: '0.0.0-life' },
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

  const pc: PairedClient = {
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
    async openWs(opts = {}) {
      const wst = await pc.issueWsToken()
      const ws = new WebSocket(`${wsBaseUrl}?wsToken=${wst.wsToken}`)
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

      const received: WsEnvelope[] = []
      const subs = new Set<(env: WsEnvelope) => void>()
      ws.on('message', (raw) => {
        try {
          const env = JSON.parse(raw.toString()) as WsEnvelope
          received.push(env)
          for (const cb of subs) cb(env)
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
          args: [{ v: 1, clientId: `test-${bootstrap.sessionId}` }],
        }),
      )
      const helloAck = await waitForEnvelope(received, (env) => env.channel === 'sys:hello-ack')
      const epoch = (helloAck.args[0] as { epoch?: number }).epoch

      if (opts.replayFrom !== undefined) {
        ws.send(
          JSON.stringify({
            v: 1,
            seq: 0,
            ts: Date.now(),
            channel: 'sys:replay-from',
            args: [{ sinceSeq: opts.replayFrom, sinceEpoch: epoch }],
          }),
        )
      }

      return {
        ws,
        received,
        onEnvelope: (cb) => {
          subs.add(cb)
          return () => subs.delete(cb)
        },
      }
    },
  } as PairedClient

  return pc
}

function waitForEnvelope(
  received: WsEnvelope[],
  predicate: (env: WsEnvelope) => boolean,
  timeoutMs = 2000,
): Promise<WsEnvelope> {
  return new Promise((resolve, reject) => {
    // Scan what we already have first.
    const existing = received.find(predicate)
    if (existing) return resolve(existing)

    const deadline = Date.now() + timeoutMs
    const iv = setInterval(() => {
      const found = received.find(predicate)
      if (found) {
        clearInterval(iv)
        resolve(found)
        return
      }
      if (Date.now() > deadline) {
        clearInterval(iv)
        reject(new Error(`timeout waiting for envelope; saw ${received.length} envelopes total`))
      }
    }, 20)
  })
}

function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === ws.CLOSED) return resolve()
    ws.once('close', () => resolve())
    ws.close()
  })
}

// -----------------------------------------------------------------------------
// Shared runtime
// -----------------------------------------------------------------------------

describe('paired-client lifecycle end-to-end', () => {
  let scratch: string
  let runtime: ServerRuntimeHandle
  let wsGateway: WsGateway
  let store: AuthStore
  let baseUrl: string
  let wsUrl: string
  let shellSessionToken: string
  /** Local "same-process" client using the shell session token — stands in for the Electron renderer. */
  let localClient: AppClient

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'wanda-life-'))
    mkdirSync(join(scratch, 'data'), { recursive: true })
    const dataDir = join(scratch, 'data')
    const appRoot = process.cwd()

    configureDatabase({
      dbPath: join(dataDir, 'test.db'),
      migrationsFolder: join(appRoot, 'electron/db/migrations'),
    })
    configureAgentRuntime({ appRoot, appVersion: '0.0.0-life', openExternal: () => {} })

    const db = await AppRuntime.runPromise(DatabaseService)
    store = createInMemoryAuthStore(CAPS.serverId, {
      db,
    })
    const authHandler = createAuthHttpHandler({ store, capabilities: CAPS })
    shellSessionToken = store.createLocalSession({
      deviceName: 'life-shell',
      os: 'darwin',
      appVersion: '0.0.0-life',
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

    const localLink = new RPCLink({
      url: baseUrl,
      headers: () => ({ authorization: `Bearer ${shellSessionToken}` }),
    })
    localClient = createORPCClient<AppClient>(localLink)
  }, 45_000)

  afterAll(async () => {
    if (wsGateway) await wsGateway.close()
    if (runtime) await runtime.stop()
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }, 30_000)

  async function newPairedClient(deviceName: string): Promise<PairedClient> {
    const pairing = store.createPairingToken()
    return pairClientInto(baseUrl, wsUrl, pairing.token, deviceName)
  }

  // ---------------------------------------------------------------------------
  // Workspace lifecycle
  // ---------------------------------------------------------------------------

  describe('workspace lifecycle', () => {
    it('paired create/rename/delete flows are visible to both sides', async () => {
      const a = await newPairedClient('laptop-ws')

      const created = (await a.client.workspace.create({
        name: 'ws-lifecycle',
        cwd: '/tmp/ws-lifecycle',
      })) as { id: string; name: string }
      expect(created.name).toBe('ws-lifecycle')

      // Both sides see it.
      const remoteList = (await a.client.workspace.list({})) as Array<{ id: string; name: string }>
      const localList = (await localClient.workspace.list({})) as Array<{ id: string; name: string }>
      expect(remoteList.some((w) => w.id === created.id)).toBe(true)
      expect(localList.some((w) => w.id === created.id)).toBe(true)

      // Rename via paired client.
      await a.client.workspace.update({ id: created.id, name: 'ws-renamed' })
      const afterRename = (await localClient.workspace.list({})) as Array<{ id: string; name: string }>
      const hit = afterRename.find((w) => w.id === created.id)
      expect(hit?.name).toBe('ws-renamed')

      // Delete via paired client.
      await a.client.workspace.delete({ id: created.id })
      const afterDelete = (await a.client.workspace.list({})) as Array<{ id: string }>
      expect(afterDelete.some((w) => w.id === created.id)).toBe(false)
    })

    it('create by local → visible to paired immediately on next list', async () => {
      const a = await newPairedClient('laptop-ws-2')
      const ws = (await localClient.workspace.create({
        name: 'from-local',
        cwd: '/tmp/from-local',
      })) as { id: string }
      const pairedView = (await a.client.workspace.list({})) as Array<{ id: string; name: string }>
      expect(pairedView.some((w) => w.id === ws.id && w.name === 'from-local')).toBe(true)
      await localClient.workspace.delete({ id: ws.id })
    })
  })

  // ---------------------------------------------------------------------------
  // Pod lifecycle
  // ---------------------------------------------------------------------------

  describe('pod lifecycle', () => {
    it('create/update/rename/delete via paired client propagates to the workspace-scoped list', async () => {
      const a = await newPairedClient('laptop-pod')
      const ws = (await a.client.workspace.create({
        name: 'pod-host-ws',
        cwd: '/tmp/pod-host-ws',
      })) as { id: string }

      const pod = (await a.client.pod.create({
        workspaceId: ws.id,
        name: 'lifecycle-pod',
        cwd: '/tmp/pod-host-ws',
      })) as { id: string; name: string }
      expect(pod.name).toBe('lifecycle-pod')

      // Present in the workspace-scoped list (this is exactly how the
      // machines page now queries pods — per workspaceId).
      const byWorkspace = (await a.client.pod.list({ workspaceId: ws.id })) as Array<{ id: string; name: string }>
      expect(byWorkspace.some((p) => p.id === pod.id)).toBe(true)

      // Rename.
      await a.client.pod.update({ id: pod.id, name: 'lifecycle-renamed' })
      const renamed = (await a.client.pod.getById({ id: pod.id })) as { name: string } | null
      expect(renamed?.name).toBe('lifecycle-renamed')

      // Update cwd.
      await a.client.pod.update({ id: pod.id, cwd: '/tmp/pod-host-ws/new' })
      const updated = (await a.client.pod.getById({ id: pod.id })) as { cwd: string } | null
      expect(updated?.cwd).toBe('/tmp/pod-host-ws/new')

      // Delete + verify gone.
      await a.client.pod.delete({ id: pod.id })
      const afterDelete = (await a.client.pod.list({ workspaceId: ws.id })) as Array<{ id: string }>
      expect(afterDelete.some((p) => p.id === pod.id)).toBe(false)

      // Clean up workspace.
      await a.client.workspace.delete({ id: ws.id })
    })

    it('duplicate creates a distinct pod under the same workspace', async () => {
      const a = await newPairedClient('laptop-pod-dup')
      const ws = (await a.client.workspace.create({ name: 'dup-ws', cwd: '/tmp/dup' })) as { id: string }
      const original = (await a.client.pod.create({
        workspaceId: ws.id,
        name: 'original',
        cwd: '/tmp/dup',
      })) as { id: string }

      const dup = (await a.client.pod.duplicate({ id: original.id })) as { id: string; workspaceId: string } | null
      expect(dup).toBeDefined()
      expect(dup!.id).not.toBe(original.id)
      expect(dup!.workspaceId).toBe(ws.id)

      const list = (await a.client.pod.list({ workspaceId: ws.id })) as Array<{ id: string }>
      expect(list.some((p) => p.id === original.id)).toBe(true)
      expect(list.some((p) => p.id === dup!.id)).toBe(true)

      await a.client.workspace.delete({ id: ws.id })
    })
  })

  // ---------------------------------------------------------------------------
  // Terminal lifecycle on a pod
  // ---------------------------------------------------------------------------

  describe('pod terminal lifecycle', () => {
    it('addTerminal / listTerminals / updateTerminal / removeTerminal round-trip', async () => {
      const a = await newPairedClient('laptop-term')
      const ws = (await a.client.workspace.create({ name: 'term-ws', cwd: '/tmp/term' })) as { id: string }
      const pod = (await a.client.pod.create({
        workspaceId: ws.id,
        name: 'term-pod',
        cwd: '/tmp/term',
      })) as { id: string }

      const term = (await a.client.pod.addTerminal({
        podId: pod.id,
        name: 'shell',
      })) as { id: string; name: string }
      expect(term.name).toBe('shell')

      const afterAdd = (await a.client.pod.listTerminals({ podId: pod.id })) as Array<{ id: string; name: string }>
      expect(afterAdd.some((t) => t.id === term.id)).toBe(true)

      await a.client.pod.updateTerminal({ id: term.id, name: 'renamed-shell' })
      const afterRename = (await a.client.pod.listTerminals({ podId: pod.id })) as Array<{ id: string; name: string }>
      expect(afterRename.find((t) => t.id === term.id)?.name).toBe('renamed-shell')

      await a.client.pod.removeTerminal({ id: term.id })
      const afterRemove = (await a.client.pod.listTerminals({ podId: pod.id })) as Array<{ id: string }>
      expect(afterRemove.some((t) => t.id === term.id)).toBe(false)

      await a.client.workspace.delete({ id: ws.id })
    })
  })

  // ---------------------------------------------------------------------------
  // Settings via paired client
  // ---------------------------------------------------------------------------

  describe('settings round-trips', () => {
    it('set then get through the paired client reflects the value', async () => {
      const a = await newPairedClient('laptop-settings')
      const key = 'test.paired.setting.' + randomBytes(4).toString('hex')

      await a.client.settings.set({ key, value: 'hello-from-A' })
      const got = (await a.client.settings.get({ key })) as string | null
      expect(got).toBe('hello-from-A')

      // getMany returns a map and includes the key we just set.
      const many = (await a.client.settings.getMany({ keys: [key, 'never.set.key'] })) as Record<string, string | null>
      expect(many[key]).toBe('hello-from-A')

      // Local (static-token) client also sees it.
      const localGot = (await localClient.settings.get({ key })) as string | null
      expect(localGot).toBe('hello-from-A')

      // Mutate via local; paired sees the new value.
      await localClient.settings.set({ key, value: 'mutated-locally' })
      const afterLocalSet = (await a.client.settings.get({ key })) as string | null
      expect(afterLocalSet).toBe('mutated-locally')

      // Null-out via paired.
      await a.client.settings.set({ key, value: null })
      const afterClear = (await a.client.settings.get({ key })) as string | null
      expect(afterClear).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Session persistence + revocation
  // ---------------------------------------------------------------------------

  describe('session persistence and revocation', () => {
    it('session token still validates after a simulated restart (same DB, fresh AuthStore)', async () => {
      const a = await newPairedClient('laptop-persist')
      // Exercise the session at least once to confirm it works.
      await a.client.workspace.list({})

      const db = await AppRuntime.runPromise(DatabaseService)
      const freshStore = createInMemoryAuthStore(CAPS.serverId, {
        db,
      })
      const hydrated = freshStore.validateSession(a.sessionToken)
      expect(hydrated?.sessionId).toBe(a.sessionId)
    })

    it('revoking an incoming session denies subsequent RPCs; re-pairing succeeds', async () => {
      const a = await newPairedClient('laptop-revoke')
      await a.client.workspace.list({})

      const revoked = store.revokeSession(a.sessionId)
      expect(revoked).toBe(true)
      await expect(a.client.workspace.list({})).rejects.toThrow()

      // Re-pair with a fresh token → new session, same device name, works again.
      const b = await newPairedClient('laptop-revoke')
      expect(b.sessionId).not.toBe(a.sessionId)
      await b.client.workspace.list({})
    })
  })

  // ---------------------------------------------------------------------------
  // Live broadcasts over WS
  // ---------------------------------------------------------------------------

  describe('live broadcasts to paired WS clients', () => {
    it('paired client receives orpc:invalidate for its own mutations', async () => {
      const a = await newPairedClient('laptop-live-single')
      const { ws, received } = await a.openWs()

      const ws1 = (await a.client.workspace.create({
        name: 'broadcast-1',
        cwd: '/tmp/broadcast-1',
      })) as { id: string }

      await waitForEnvelope(
        received,
        (e) => e.channel === 'orpc:invalidate' && e.args[0] === 'workspace' && e.args[1] === 'create',
      )

      // Cleanup + second envelope shape: delete invalidate also flows.
      received.length = 0
      await a.client.workspace.delete({ id: ws1.id })
      await waitForEnvelope(
        received,
        (e) => e.channel === 'orpc:invalidate' && e.args[0] === 'workspace' && e.args[1] === 'delete',
      )

      await closeWs(ws)
    })

    it('two paired clients both receive the same broadcast from a shared mutation', async () => {
      const a = await newPairedClient('laptop-fan-A')
      const c = await newPairedClient('laptop-fan-C')
      const sockA = await a.openWs()
      const sockC = await c.openWs()

      const ws = (await a.client.workspace.create({
        name: 'fan-out',
        cwd: '/tmp/fan-out',
      })) as { id: string }

      await Promise.all([
        waitForEnvelope(
          sockA.received,
          (e) => e.channel === 'orpc:invalidate' && e.args[0] === 'workspace' && e.args[1] === 'create',
        ),
        waitForEnvelope(
          sockC.received,
          (e) => e.channel === 'orpc:invalidate' && e.args[0] === 'workspace' && e.args[1] === 'create',
        ),
      ])

      // Flip: a mutation from client C reaches client A too.
      await c.client.workspace.delete({ id: ws.id })
      await waitForEnvelope(
        sockA.received,
        (e) => e.channel === 'orpc:invalidate' && e.args[0] === 'workspace' && e.args[1] === 'delete',
      )

      await closeWs(sockA.ws)
      await closeWs(sockC.ws)
    })

    it('broadcasts carry monotonic seq numbers for replay addressing', async () => {
      const a = await newPairedClient('laptop-seq')
      const { ws, received } = await a.openWs()

      const w1 = (await a.client.workspace.create({ name: 'seq-1', cwd: '/tmp/seq-1' })) as { id: string }
      const w2 = (await a.client.workspace.create({ name: 'seq-2', cwd: '/tmp/seq-2' })) as { id: string }

      const first = await waitForEnvelope(received, (e) => e.channel === 'event:workspace:created')
      // Both create events queued; find the second one too.
      await waitForEnvelope(received, (e) => e.channel === 'event:workspace:created' && e.seq > first.seq)

      const creates = received.filter((e) => e.channel === 'event:workspace:created')
      const seqs = creates.map((e) => e.seq)
      // Every replayable envelope should have a non-zero seq and be strictly
      // increasing in the order we created workspaces.
      for (const s of seqs) expect(s).toBeGreaterThan(0)
      for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!)

      await a.client.workspace.delete({ id: w1.id })
      await a.client.workspace.delete({ id: w2.id })
      await closeWs(ws)
    })

    it('sys:ping/pong keepalive round-trips so idle connections stay open', async () => {
      const a = await newPairedClient('laptop-ping')
      const { ws, received } = await a.openWs()
      // The server emits sys:ping periodically; we cannot wait 15s in a
      // unit test, so we just verify that sending a sys:pong from the
      // client does not trip the gateway (the gateway discards it
      // silently — any error would close the socket).
      ws.send(JSON.stringify({ v: 1, seq: 0, ts: Date.now(), channel: 'sys:pong', args: [] }))
      // Give the server a beat to process.
      await new Promise((r) => setTimeout(r, 50))
      expect(ws.readyState).toBe(ws.OPEN)
      // Mutations still flow.
      const w = (await a.client.workspace.create({ name: 'ping-ws', cwd: '/tmp/ping-ws' })) as { id: string }
      await waitForEnvelope(received, (e) => e.channel === 'orpc:invalidate' && e.args[0] === 'workspace')
      await a.client.workspace.delete({ id: w.id })
      await closeWs(ws)
    })
  })

  // ---------------------------------------------------------------------------
  // Reconnect + replay
  // ---------------------------------------------------------------------------

  describe('WS reconnect + replay', () => {
    it('client that disconnects and reconnects with sys:replay-from receives missed envelopes', async () => {
      const a = await newPairedClient('laptop-replay')

      // Phase 1: open, capture the seq of the last durable event we saw.
      // Replay-from addresses event-log records (event:* channels); the
      // firehose-only `orpc:invalidate` broadcasts are ephemeral.
      const first = await a.openWs()
      const w1 = (await a.client.workspace.create({
        name: 'replay-initial',
        cwd: '/tmp/replay-initial',
      })) as { id: string }
      const env1 = await waitForEnvelope(first.received, (e) => e.channel === 'event:workspace:created')
      const lastSeen = env1.seq
      expect(lastSeen).toBeGreaterThan(0)

      // Phase 2: disconnect, perform mutations while offline.
      await closeWs(first.ws)
      const w2 = (await a.client.workspace.create({
        name: 'replay-missed-1',
        cwd: '/tmp/replay-missed-1',
      })) as { id: string }
      const w3 = (await a.client.workspace.create({
        name: 'replay-missed-2',
        cwd: '/tmp/replay-missed-2',
      })) as { id: string }

      // Phase 3: reconnect with `sys:replay-from` → missed envelopes
      // arrive + a sys:replay-complete sentinel.
      const second = await a.openWs({ replayFrom: lastSeen })

      await waitForEnvelope(second.received, (e) => e.channel === 'sys:replay-complete')
      const replayed = second.received.filter((e) => e.channel === 'event:workspace:created')
      // At least two replayed creates (the two we did while offline). The
      // buffer may also include the initial create depending on timing
      // bounds — we just assert the missed ones are there.
      expect(replayed.length).toBeGreaterThanOrEqual(2)
      // Every replayed envelope has seq > lastSeen.
      for (const e of replayed) expect(e.seq).toBeGreaterThan(lastSeen)

      await a.client.workspace.delete({ id: w1.id })
      await a.client.workspace.delete({ id: w2.id })
      await a.client.workspace.delete({ id: w3.id })
      await closeWs(second.ws)
    })
  })
})
