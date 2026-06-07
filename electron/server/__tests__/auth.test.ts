// -----------------------------------------------------------------------------
// Pairing / session / WS-token tests.
//
// Covers both the pure AuthStore (lifetime + single-use semantics) and the
// HTTP surface (bootstrap / ws-token / capabilities endpoints). No DB, no
// Effect runtime — the auth layer must be independently testable.
// -----------------------------------------------------------------------------

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BootstrapResult, WsTokenResult } from '../../../shared/contracts/auth'
import type { ServerCapabilities } from '../../../shared/contracts/capabilities'
import { type AuthStore, createAuthHttpHandler, createInMemoryAuthStore } from '../auth'

const CLIENT_INFO = { deviceName: 'macbook-pro', os: 'darwin', appVersion: '0.0.0-test' }

const FAKE_CAPS: ServerCapabilities = {
  serverId: 'test-server-1',
  hostname: 'test-host',
  appVersion: '0.0.0-test',
  ssh: { host: 'test-host.tailnet', user: 'tester', port: 22, workspacePath: '/home/tester/work' },
  features: { docker: true, agents: true, workspaceRoot: '/home/tester/work' },
}

describe('AuthStore (in-memory)', () => {
  let store: AuthStore

  beforeEach(() => {
    store = createInMemoryAuthStore(FAKE_CAPS.serverId, {
      pairingTokenTtlMs: 200,
      sessionTokenTtlMs: 60_000,
      wsTokenTtlMs: 100,
    })
  })

  it('creates pairing tokens that can be exchanged for a session', () => {
    const pt = store.createPairingToken()
    expect(typeof pt.token).toBe('string')
    expect(pt.token.length).toBeGreaterThan(16)

    const result = store.consumePairingToken(pt.token, CLIENT_INFO)
    expect(result).not.toBeNull()
    expect(result!.serverId).toBe(FAKE_CAPS.serverId)
    expect(result!.role).toBe('owner')
    expect(result!.expiresAt).toBeGreaterThan(Date.now())
  })

  it('rejects an unknown pairing token', () => {
    expect(store.consumePairingToken('not-a-real-token', CLIENT_INFO)).toBeNull()
  })

  it('pairing tokens are single-use — second exchange fails', () => {
    const pt = store.createPairingToken()
    const first = store.consumePairingToken(pt.token, CLIENT_INFO)
    expect(first).not.toBeNull()
    const second = store.consumePairingToken(pt.token, CLIENT_INFO)
    expect(second).toBeNull()
  })

  it('pairing tokens expire after the configured TTL', async () => {
    const pt = store.createPairingToken()
    await new Promise((r) => setTimeout(r, 220))
    expect(store.consumePairingToken(pt.token, CLIENT_INFO)).toBeNull()
  })

  it('validates issued session tokens and rejects unknown ones', () => {
    const pt = store.createPairingToken()
    const session = store.consumePairingToken(pt.token, CLIENT_INFO)!
    const validated = store.validateSession(session.sessionToken)
    expect(validated).not.toBeNull()
    expect(validated!.sessionId).toBe(session.sessionId)

    expect(store.validateSession('nope')).toBeNull()
  })

  it('issues ws-tokens from a valid session and consumes them once', () => {
    const pt = store.createPairingToken()
    const session = store.consumePairingToken(pt.token, CLIENT_INFO)!

    const wst = store.issueWsToken(session.sessionToken)
    expect(wst).not.toBeNull()
    expect(typeof wst!.wsToken).toBe('string')

    const consumed = store.consumeWsToken(wst!.wsToken)
    expect(consumed).not.toBeNull()
    expect(consumed!.sessionId).toBe(session.sessionId)

    // Second consume fails — one-shot.
    expect(store.consumeWsToken(wst!.wsToken)).toBeNull()
  })

  it('ws-tokens expire after the configured TTL', async () => {
    const pt = store.createPairingToken()
    const session = store.consumePairingToken(pt.token, CLIENT_INFO)!
    const wst = store.issueWsToken(session.sessionToken)!
    await new Promise((r) => setTimeout(r, 140))
    expect(store.consumeWsToken(wst.wsToken)).toBeNull()
  })

  it('revokes sessions and subsequent validations fail', () => {
    const pt = store.createPairingToken()
    const session = store.consumePairingToken(pt.token, CLIENT_INFO)!
    expect(store.revokeSession(session.sessionId)).toBe(true)
    expect(store.validateSession(session.sessionToken)).toBeNull()
  })

  it('listSessions surfaces paired device metadata', () => {
    const pt = store.createPairingToken()
    const session = store.consumePairingToken(pt.token, CLIENT_INFO)!
    const sessions = store.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.sessionId).toBe(session.sessionId)
    expect(sessions[0]!.device.deviceName).toBe('macbook-pro')
  })
})

describe('auth HTTP surface', () => {
  let server: HttpServer
  let store: AuthStore
  let port: number

  async function postJson(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{
    status: number
    body: unknown
  }> {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    let parsed: unknown = text
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null
    } catch {
      /* keep as string */
    }
    return { status: res.status, body: parsed }
  }

  async function getJson(
    path: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers })
    const text = await res.text()
    let parsed: unknown = text
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null
    } catch {
      /* keep as string */
    }
    return { status: res.status, body: parsed }
  }

  beforeEach(async () => {
    store = createInMemoryAuthStore(FAKE_CAPS.serverId)
    const handler = createAuthHttpHandler({ store, capabilities: FAKE_CAPS })
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const handled = await handler(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    port = (server.address() as AddressInfo).port
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('POST /api/auth/bootstrap exchanges a pairing token for a session', async () => {
    const pt = store.createPairingToken()
    const { status, body } = await postJson('/api/auth/bootstrap', {
      pairingToken: pt.token,
      client: CLIENT_INFO,
    })
    expect(status).toBe(200)
    const result = body as BootstrapResult
    expect(typeof result.sessionToken).toBe('string')
    expect(result.serverId).toBe(FAKE_CAPS.serverId)
    expect(result.role).toBe('owner')
  })

  it('POST /api/auth/bootstrap with invalid pairing token returns 401', async () => {
    const { status } = await postJson('/api/auth/bootstrap', {
      pairingToken: 'not-real',
      client: CLIENT_INFO,
    })
    expect(status).toBe(401)
  })

  it('POST /api/auth/bootstrap with malformed body returns 400', async () => {
    const { status } = await postJson('/api/auth/bootstrap', { wrong: 'shape' })
    expect(status).toBe(400)
  })

  it('POST /api/auth/ws-token returns a one-shot WS token given a valid session', async () => {
    const pt = store.createPairingToken()
    const bootstrap = store.consumePairingToken(pt.token, CLIENT_INFO)!
    const { status, body } = await postJson(
      '/api/auth/ws-token',
      {},
      { authorization: `Bearer ${bootstrap.sessionToken}` },
    )
    expect(status).toBe(200)
    const result = body as WsTokenResult
    expect(typeof result.wsToken).toBe('string')
    expect(result.expiresAt).toBeGreaterThan(Date.now())
  })

  it('POST /api/auth/ws-token without a session token returns 401', async () => {
    const { status } = await postJson('/api/auth/ws-token', {})
    expect(status).toBe(401)
  })

  it('GET /api/capabilities returns the server descriptor given a valid session', async () => {
    const pt = store.createPairingToken()
    const bootstrap = store.consumePairingToken(pt.token, CLIENT_INFO)!
    const { status, body } = await getJson('/api/capabilities', {
      authorization: `Bearer ${bootstrap.sessionToken}`,
    })
    expect(status).toBe(200)
    const caps = body as ServerCapabilities
    expect(caps.serverId).toBe(FAKE_CAPS.serverId)
    expect(caps.hostname).toBe(FAKE_CAPS.hostname)
    expect(caps.ssh?.host).toBe('test-host.tailnet')
  })

  it('GET /api/capabilities without a session token returns 401', async () => {
    const { status } = await getJson('/api/capabilities')
    expect(status).toBe(401)
  })
})
