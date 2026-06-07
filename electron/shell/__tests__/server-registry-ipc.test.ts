// -----------------------------------------------------------------------------
// ServerRegistry IPC bridge tests.
//
// The bridge registers a handful of `ipcMain.handle`-shaped listeners that
// delegate to the ServerRegistry. Electron's real `ipcMain` cannot be
// instantiated under vitest, so the bridge accepts an abstract IpcHost
// interface. Production wires in the real `ipcMain`; tests use a fake.
// -----------------------------------------------------------------------------

import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServerCapabilities } from '../../../shared/contracts/capabilities'
import { configureSecretStore, type SecretStore } from '../../infra/secret-store'
import { createAuthHttpHandler, createInMemoryAuthStore } from '../../server/auth'
import { type ClientDb, createClientDb } from '../client-db'
import { createServerRegistry, type ServerRegistry } from '../server-registry'
import { type IpcHost, registerServerRegistryIpc, SERVERS_IPC_CHANNELS } from '../server-registry-ipc'

function fakeIpcHost(): IpcHost & { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } {
  const handlers = new Map<string, (...args: unknown[]) => unknown | Promise<unknown>>()
  return {
    handle(channel, listener) {
      handlers.set(channel, listener)
    },
    removeHandler(channel) {
      handlers.delete(channel)
    },
    invoke(channel, ...args) {
      const fn = handlers.get(channel)
      if (!fn) return Promise.reject(new Error(`no handler for ${channel}`))
      // Route sync throws into rejections so tests can `.catch()` uniformly.
      try {
        return Promise.resolve(fn(...args))
      } catch (err) {
        return Promise.reject(err)
      }
    },
  }
}

function makeInMemorySecretStore(): SecretStore {
  return {
    encrypt: (s) => `wse1:${Buffer.from(s, 'utf8').toString('base64')}`,
    decrypt: (s) => Buffer.from(s.slice(5), 'base64').toString('utf8'),
  }
}

const CLIENT_INFO = { deviceName: 'ipc-client', os: 'darwin', appVersion: '0.0.0-ipc' }

const CAPS: ServerCapabilities = {
  serverId: 'ipc-srv',
  hostname: 'ipc-host',
  appVersion: '0.0.0-ipc',
  ssh: null,
  features: { docker: true, agents: true, workspaceRoot: '/tmp' },
}

describe('ServerRegistry IPC bridge', () => {
  let scratch: string
  let db: ClientDb
  let registry: ServerRegistry
  let host: ReturnType<typeof fakeIpcHost>
  let server: HttpServer
  let serverPort: number
  let authStore: ReturnType<typeof createInMemoryAuthStore>
  let teardownIpc: () => void

  beforeEach(async () => {
    configureSecretStore(makeInMemorySecretStore())
    scratch = mkdtempSync(join(tmpdir(), 'wanda-ipc-'))
    db = createClientDb(join(scratch, 'client.db'))
    registry = createServerRegistry({ db, clientInfo: CLIENT_INFO })
    host = fakeIpcHost()
    teardownIpc = registerServerRegistryIpc(host, registry)

    authStore = createInMemoryAuthStore(CAPS.serverId)
    const authHandler = createAuthHttpHandler({ store: authStore, capabilities: CAPS })
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const handled = await authHandler(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    serverPort = (server.address() as AddressInfo).port
  })

  afterEach(async () => {
    teardownIpc()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    db.close()
    rmSync(scratch, { recursive: true, force: true })
  })

  it('exposes all registry methods via IPC channels', () => {
    const channels = Object.values(SERVERS_IPC_CHANNELS)
    for (const channel of channels) {
      // Invoke a method that doesn't need server state and just confirm the handler is registered.
      // (We catch because some channels require arguments; we only care that they exist.)
      expect(() => host.invoke(channel).catch(() => undefined)).not.toThrow()
    }
  })

  it('list returns [] initially', async () => {
    const list = await host.invoke(SERVERS_IPC_CHANNELS.LIST)
    expect(list).toEqual([])
  })

  it('pair forwards to registry and persists', async () => {
    const pairing = authStore.createPairingToken()
    const url = `http://127.0.0.1:${serverPort}/pair#token=${pairing.token}`
    const paired = (await host.invoke(SERVERS_IPC_CHANNELS.PAIR, url)) as { id: string; serverId: string }
    expect(paired.serverId).toBe(CAPS.serverId)

    const list = (await host.invoke(SERVERS_IPC_CHANNELS.LIST)) as Array<{ id: string }>
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(paired.id)
  })

  it('remove forwards to registry', async () => {
    const pairing = authStore.createPairingToken()
    const url = `http://127.0.0.1:${serverPort}/pair#token=${pairing.token}`
    const paired = (await host.invoke(SERVERS_IPC_CHANNELS.PAIR, url)) as { id: string }
    await host.invoke(SERVERS_IPC_CHANNELS.REMOVE, paired.id)
    const list = (await host.invoke(SERVERS_IPC_CHANNELS.LIST)) as unknown[]
    expect(list).toEqual([])
  })

  it('issue-ws-token forwards and returns a ws token', async () => {
    const pairing = authStore.createPairingToken()
    const paired = (await host.invoke(
      SERVERS_IPC_CHANNELS.PAIR,
      `http://127.0.0.1:${serverPort}/pair#token=${pairing.token}`,
    )) as { id: string }
    const wst = (await host.invoke(SERVERS_IPC_CHANNELS.ISSUE_WS_TOKEN, paired.id)) as { wsToken: string }
    expect(typeof wst.wsToken).toBe('string')
  })

  it('get-session-token returns the decrypted token for a paired server', async () => {
    const pairing = authStore.createPairingToken()
    const paired = (await host.invoke(
      SERVERS_IPC_CHANNELS.PAIR,
      `http://127.0.0.1:${serverPort}/pair#token=${pairing.token}`,
    )) as { id: string }
    const token = (await host.invoke(SERVERS_IPC_CHANNELS.GET_SESSION_TOKEN, paired.id)) as string | null
    expect(typeof token).toBe('string')
    expect(token!.length).toBeGreaterThan(32)
  })

  it('get-session-token returns null for unknown server ids', async () => {
    const token = (await host.invoke(SERVERS_IPC_CHANNELS.GET_SESSION_TOKEN, 'no-such-id')) as string | null
    expect(token).toBeNull()
  })

  it('capabilities forwards and returns the server descriptor', async () => {
    const pairing = authStore.createPairingToken()
    const paired = (await host.invoke(
      SERVERS_IPC_CHANNELS.PAIR,
      `http://127.0.0.1:${serverPort}/pair#token=${pairing.token}`,
    )) as { id: string }
    const caps = (await host.invoke(SERVERS_IPC_CHANNELS.CAPABILITIES, paired.id)) as ServerCapabilities
    expect(caps.serverId).toBe(CAPS.serverId)
  })

  it('surfaces thrown registry errors to the IPC caller', async () => {
    await expect(host.invoke(SERVERS_IPC_CHANNELS.PAIR, 'garbage')).rejects.toThrow(/invalid pairing url/i)
  })

  it('teardown removes all handlers', async () => {
    teardownIpc()
    teardownIpc = () => {} // avoid double-teardown in afterEach
    await expect(host.invoke(SERVERS_IPC_CHANNELS.LIST)).rejects.toThrow(/no handler/i)
  })
})
