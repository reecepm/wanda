// -----------------------------------------------------------------------------
// ServerRegistry tests.
//
// The registry lives in the Electron main process and owns the list of
// paired wanda servers (local embedded + any paired remotes). It persists
// metadata to a client-local SQLite and stores session tokens via the
// SecretStore abstraction (AES backend in prod, in-memory in tests).
//
// Tests drive the registry against a real wanda server (via createInMemory
// AuthStore + bare HTTP server) so the bootstrap / capabilities calls it
// makes are real fetches, not mocks.
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

const CLIENT_INFO = { deviceName: 'test-client', os: 'darwin', appVersion: '0.0.0-test' }

function makeInMemorySecretStore(): SecretStore {
  // Simplest possible pass-through — test-only. Real code uses AES.
  return {
    encrypt: (s) => `wse1:${Buffer.from(s, 'utf8').toString('base64')}`,
    decrypt: (s) => {
      const b64 = s.slice(5)
      return Buffer.from(b64, 'base64').toString('utf8')
    },
  }
}

function makeCaps(serverId: string, hostname: string): ServerCapabilities {
  return {
    serverId,
    hostname,
    appVersion: '0.0.0-test',
    ssh: null,
    features: { docker: true, agents: true, workspaceRoot: '/tmp' },
  }
}

interface FakeServerHandle {
  readonly url: string
  readonly store: ReturnType<typeof createInMemoryAuthStore>
  readonly capabilities: ServerCapabilities
  stop(): Promise<void>
}

async function spinUpFakeServer(serverId: string, hostname: string): Promise<FakeServerHandle> {
  const caps = makeCaps(serverId, hostname)
  const store = createInMemoryAuthStore(serverId)
  const handler = createAuthHttpHandler({ store, capabilities: caps })
  const server: HttpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const handled = await handler(req, res)
    if (!handled) {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    store,
    capabilities: caps,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe('ServerRegistry', () => {
  let scratch: string
  let db: ClientDb
  let registry: ServerRegistry
  let server: FakeServerHandle

  beforeEach(async () => {
    configureSecretStore(makeInMemorySecretStore())
    scratch = mkdtempSync(join(tmpdir(), 'wanda-registry-'))
    db = createClientDb(join(scratch, 'client.db'))
    registry = createServerRegistry({ db, clientInfo: CLIENT_INFO })
    server = await spinUpFakeServer('srv-1', 'server-1-host')
  })

  afterEach(async () => {
    await server.stop()
    db.close()
    rmSync(scratch, { recursive: true, force: true })
  })

  it('starts with no paired servers', () => {
    expect(registry.list()).toEqual([])
  })

  it('pairs a server from a pairing URL and persists it', async () => {
    const pairing = server.store.createPairingToken()
    const url = `${server.url}/pair#token=${pairing.token}`

    const paired = await registry.pair(url)
    expect(paired.serverId).toBe('srv-1')
    expect(paired.label).toBe('server-1-host')
    expect(paired.baseUrl).toBe(server.url)

    const list = registry.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.serverId).toBe('srv-1')
  })

  it('stores the session token encrypted and retrieves it transparently', async () => {
    const pairing = server.store.createPairingToken()
    const paired = await registry.pair(`${server.url}/pair#token=${pairing.token}`)

    // Direct DB inspection: persisted token must NOT be plaintext.
    const raw = db.getRawSessionTokenCiphertext(paired.id)
    expect(raw).toBeTruthy()
    expect(raw!.startsWith('wse1:')).toBe(true)

    // Via the registry: decrypted access returns the original.
    const token = registry.getSessionToken(paired.id)
    expect(typeof token).toBe('string')
    expect(token!.length).toBeGreaterThan(32)
  })

  it('rejects pairing with an invalid URL', async () => {
    await expect(registry.pair('not-a-real-url')).rejects.toThrow(/invalid pairing url/i)
  })

  it('rejects pairing against an unreachable server', async () => {
    await expect(registry.pair('http://127.0.0.1:1/pair#token=x')).rejects.toThrow()
  })

  it('rejects pairing with an expired/unknown pairing token', async () => {
    await expect(registry.pair(`${server.url}/pair#token=never-issued`)).rejects.toThrow(/pairing failed/i)
  })

  it('removes a paired server and drops its session token', async () => {
    const pairing = server.store.createPairingToken()
    const paired = await registry.pair(`${server.url}/pair#token=${pairing.token}`)

    registry.remove(paired.id)
    expect(registry.list()).toEqual([])
    expect(registry.getSessionToken(paired.id)).toBeNull()
  })

  it('handles multiple paired servers independently', async () => {
    const server2 = await spinUpFakeServer('srv-2', 'server-2-host')
    try {
      const p1 = await registry.pair(`${server.url}/pair#token=${server.store.createPairingToken().token}`)
      const p2 = await registry.pair(`${server2.url}/pair#token=${server2.store.createPairingToken().token}`)
      expect(p1.serverId).toBe('srv-1')
      expect(p2.serverId).toBe('srv-2')

      const list = registry.list().sort((a, b) => a.serverId.localeCompare(b.serverId))
      expect(list.map((s) => s.serverId)).toEqual(['srv-1', 'srv-2'])
    } finally {
      await server2.stop()
    }
  })

  it('survives a registry re-open (persistence round-trip)', async () => {
    const pairing = server.store.createPairingToken()
    const paired = await registry.pair(`${server.url}/pair#token=${pairing.token}`)

    // Close + reopen the DB, re-create registry.
    db.close()
    const db2 = createClientDb(join(scratch, 'client.db'))
    const registry2 = createServerRegistry({ db: db2, clientInfo: CLIENT_INFO })
    try {
      const list = registry2.list()
      expect(list).toHaveLength(1)
      expect(list[0]!.serverId).toBe('srv-1')
      // Session token is still retrievable after re-open.
      expect(registry2.getSessionToken(paired.id)).toBeTruthy()
    } finally {
      db2.close()
    }
  })

  it('issues a fresh ws-token on demand using the stored session', async () => {
    const pairing = server.store.createPairingToken()
    const paired = await registry.pair(`${server.url}/pair#token=${pairing.token}`)

    const wst = await registry.issueWsToken(paired.id)
    expect(typeof wst.wsToken).toBe('string')
    expect(wst.expiresAt).toBeGreaterThan(Date.now())
  })
})
