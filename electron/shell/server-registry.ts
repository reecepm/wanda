// -----------------------------------------------------------------------------
// Client-side registry of paired wanda servers.
//
// Runs in the Electron main process. Owns:
//
//   - The list of paired servers (persisted to client.sqlite).
//   - The pairing handshake (POSTs /api/auth/bootstrap to a target server).
//   - Encrypted storage of session tokens (via SecretStore).
//   - On-demand minting of one-shot WS tokens for renderer connections.
//
// The renderer never sees session tokens directly — it asks the registry
// for a WS token when it's about to open a WebSocket, which keeps the
// long-lived credential in the main process.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { BootstrapResult, PairedClientInfo, WsTokenResult } from '../../shared/contracts/auth'
import type { ServerCapabilities } from '../../shared/contracts/capabilities'
import { decryptSecret, encryptSecret } from '../infra/secret-store'
import { parsePairingUrl } from '../services/pairing-url'
import type { ClientDb, PairedServerRecord } from './client-db'

export interface PairedServer {
  readonly id: string
  readonly serverId: string
  readonly label: string
  readonly baseUrl: string
  readonly addedAt: number
  readonly lastConnectedAt: number | null
}

export interface ServerRegistryOpts {
  readonly db: ClientDb
  readonly clientInfo: PairedClientInfo
  /**
   * Optional fetch override. Lets tests swap in a fake without touching
   * the real network. Defaults to `globalThis.fetch`.
   */
  readonly fetchImpl?: typeof fetch
}

export interface ServerRegistry {
  list(): PairedServer[]
  pair(pairingUrl: string): Promise<PairedServer>
  remove(id: string): void
  getSessionToken(id: string): string | null
  issueWsToken(id: string): Promise<WsTokenResult>
  capabilities(id: string): Promise<ServerCapabilities>
  /**
   * The remote server likely restarted on a new (ephemeral) port and the
   * stored baseUrl is stale. Probe a short list of well-known
   * `<hostname>:<port>` candidates for a reachable server that reports
   * the same `serverId`; on match, update the stored baseUrl and return
   * the new URL. Returns null if no candidate matched. Never modifies
   * the session token — auth stays valid because the remote persists
   * session rows.
   */
  probeAndHeal(id: string): Promise<string | null>
}

function toPairedServer(rec: PairedServerRecord): PairedServer {
  return {
    id: rec.id,
    serverId: rec.serverId,
    label: rec.label,
    baseUrl: rec.baseUrl,
    addedAt: rec.addedAt,
    lastConnectedAt: rec.lastConnectedAt,
  }
}

export function createServerRegistry(opts: ServerRegistryOpts): ServerRegistry {
  const { db, clientInfo } = opts
  const doFetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))

  interface JsonInit {
    readonly method?: string
    readonly headers?: HeadersInit
    readonly body?: unknown
  }

  async function callJson<T>(url: string, init: JsonInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (init.body != null && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    const res = await doFetch(url, {
      method: init.method,
      headers,
      body: init.body == null ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
    })
    if (!res.ok) {
      throw new Error(`${init.method ?? 'GET'} ${url} failed: ${res.status} ${await res.text().catch(() => '')}`)
    }
    return (await res.json()) as T
  }

  return {
    list() {
      return db.list().map(toPairedServer)
    },

    async pair(pairingUrl) {
      const parsed = parsePairingUrl(pairingUrl)
      if (!parsed) {
        throw new Error(`invalid pairing url: ${pairingUrl}`)
      }
      let bootstrap: BootstrapResult
      try {
        bootstrap = await callJson<BootstrapResult>(`${parsed.baseUrl}/api/auth/bootstrap`, {
          method: 'POST',
          body: { pairingToken: parsed.pairingToken, client: clientInfo },
        })
      } catch (err) {
        throw new Error(`pairing failed against ${parsed.baseUrl}: ${(err as Error).message}`)
      }

      // Fetch capabilities to get a display label. A capability failure
      // here is non-fatal — we still persist the session.
      let label = bootstrap.serverId
      try {
        const caps = await callJson<ServerCapabilities>(`${parsed.baseUrl}/api/capabilities`, {
          headers: { authorization: `Bearer ${bootstrap.sessionToken}` },
        })
        label = caps.hostname || caps.serverId
      } catch {
        /* keep fallback label */
      }

      // Re-pairing into the same server_id is a legitimate flow (e.g. the
      // user lost the session, or wants to rotate credentials). Drop any
      // existing row for this server_id first so the UNIQUE(server_id)
      // index doesn't reject the insert. The old session stays valid on
      // the remote until its own TTL; it's fine to have both present
      // briefly since the registry only uses the freshly-persisted one.
      const existing = db.list().find((r) => r.serverId === bootstrap.serverId)
      if (existing) {
        db.remove(existing.id)
      }

      const id = randomUUID()
      db.insert({
        id,
        serverId: bootstrap.serverId,
        label,
        baseUrl: parsed.baseUrl,
        sessionTokenCiphertext: encryptSecret(bootstrap.sessionToken),
      })
      const rec = db.get(id)!
      return toPairedServer(rec)
    },

    remove(id) {
      db.remove(id)
    },

    getSessionToken(id) {
      const raw = db.getRawSessionTokenCiphertext(id)
      if (!raw) return null
      return decryptSecret(raw)
    },

    async issueWsToken(id) {
      const rec = db.get(id)
      if (!rec) throw new Error(`unknown paired server: ${id}`)
      const token = decryptSecret(db.getRawSessionTokenCiphertext(id) ?? '')
      const result = await callJson<WsTokenResult>(`${rec.baseUrl}/api/auth/ws-token`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      db.markConnected(id)
      return result
    },

    async capabilities(id) {
      const rec = db.get(id)
      if (!rec) throw new Error(`unknown paired server: ${id}`)
      const token = decryptSecret(db.getRawSessionTokenCiphertext(id) ?? '')
      return callJson<ServerCapabilities>(`${rec.baseUrl}/api/capabilities`, {
        headers: { authorization: `Bearer ${token}` },
      })
    },

    async probeAndHeal(id) {
      const rec = db.get(id)
      if (!rec) return null
      const token = decryptSecret(db.getRawSessionTokenCiphertext(id) ?? '')
      if (!token) return null

      // Parse the stored baseUrl once so we can substitute ports.
      let parsed: URL
      try {
        parsed = new URL(rec.baseUrl)
      } catch {
        return null
      }

      // Candidates to try, in order. Most likely → least:
      //   1. The WANDA default stable network port (9876). Wanda now
      //      binds to this by default when exposed on the network, so
      //      after any restart the correct port is almost always 9876.
      //   2. The stored port, in case the server IS still there and
      //      this probe is being called for a transient reason.
      // Future: add mDNS / TXT-record discovery so we don't need
      // hard-coded ports at all.
      const DEFAULT_NETWORK_PORT = 9876
      const candidates = new Set<number>()
      candidates.add(DEFAULT_NETWORK_PORT)
      if (parsed.port) {
        const n = Number.parseInt(parsed.port, 10)
        if (Number.isFinite(n) && n > 0) candidates.add(n)
      }

      for (const port of candidates) {
        const candidateUrl = `${parsed.protocol}//${parsed.hostname}:${port}`
        try {
          // `/api/capabilities` requires a valid session token — so a
          // 200 proves BOTH reachability AND that the session on the
          // other end still knows us. A 401 means the server exists but
          // our session is stale (handled by returning null, callers
          // then prompt for re-pair).
          const caps = await callJson<ServerCapabilities>(`${candidateUrl}/api/capabilities`, {
            headers: { authorization: `Bearer ${token}` },
          })
          if (caps.serverId === rec.serverId) {
            if (candidateUrl !== rec.baseUrl) {
              db.updateBaseUrl(id, candidateUrl)
            }
            return candidateUrl
          }
          // Different serverId on that port — ignore, don't overwrite
          // the stored baseUrl, move to next candidate.
        } catch {
          // Unreachable / TLS error / 401 — try next candidate.
        }
      }
      return null
    },
  }
}
