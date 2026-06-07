// Terminal transport registry.
//
// The TerminalRegistry needs a transport — something that knows how to
// `write`/`resize` a PTY and how to `onData`/`onExit` subscribe to it.
// Terminals on a local pod use the preload (`window.wanda.terminal.*`);
// terminals on a remote pod need their reads and writes routed to the
// paired server's WS via `PairedTerminalBridge`.
//
// Since the acquire path in `terminal-registry.ts` only knows the
// `ptyInstanceId` at terminal-creation time, we use a small module-
// scoped map: any caller that knows a terminal lives on a specific
// paired server (i.e. the pod-page view renderer when `active.kind ===
// 'remote'`) registers `terminalId → registryId` *before* the registry
// acquires the xterm. The registry consults this map at acquire time
// and, if present, swaps in the paired transport. If absent, the
// local `window.wanda.terminal` surface is used.

import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import {
  disposePairedTerminalBridge,
  getPairedTerminalBridge,
  getServerSessionToken,
  listPairedServers,
} from '@/features/servers'
import { orpcUtils } from '@/shared/orpc'
import { drainPairedOutbox } from '@/shared/paired-client-outbox'
import type { AppClient } from '../../../shared/contracts'
import { terminalRegistry } from './terminal-registry'

export interface TerminalTransport {
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  /** Returns an unsubscribe function. */
  onData(id: string, cb: (data: string) => void): () => void
  /** Returns an unsubscribe function. */
  onExit(id: string, cb: (code: number) => void): () => void
  /** Fetch the server's scrollback snapshot for this terminal. */
  getScrollback(id: string): Promise<string | null>
  /** Drop server-side scrollback for this terminal. PTY stays alive. */
  clear(id: string): Promise<void>
}

type TerminalUrlDetectedHandler = (streamId: string, url: string, podId: string | null) => void
type TerminalZoomHandler = Parameters<typeof window.wanda.terminal.onZoom>[0]

const localTransport: TerminalTransport = {
  write: (id, data) => window.wanda.terminal.write(id, data),
  resize: (id, cols, rows) => window.wanda.terminal.resize(id, cols, rows),
  onData: (id, cb) => window.wanda.terminal.onData(id, cb),
  onExit: (id, cb) => window.wanda.terminal.onExit(id, cb),
  getScrollback: async (id) => {
    const result = await orpcUtils.terminal.getScrollback.call({ id })
    return (result ?? null) as string | null
  },
  clear: async (id) => {
    await orpcUtils.terminal.clear.call({ id })
  },
}

export function onTerminalUrlDetected(handler: TerminalUrlDetectedHandler): () => void {
  return window.wanda.terminal.onUrlDetected(handler)
}

export function openExternalUrl(url: string): void {
  window.wanda.shell.openExternal(url)
}

export function canOpenExternalUrls(): boolean {
  return window.wanda.env.canOpenExternal
}

export function onTerminalZoom(handler: TerminalZoomHandler): () => void {
  return window.wanda.terminal.onZoom(handler)
}

// Memoize paired RPC clients per registryId so repeated transport calls
// don't rebuild the link each time.
const pairedRpcClients = new Map<string, Promise<AppClient>>()
async function getPairedRpcClient(registryId: string): Promise<AppClient> {
  const existing = pairedRpcClients.get(registryId)
  if (existing) return existing
  const promise = (async () => {
    const servers = await listPairedServers()
    const server = servers.find((s) => s.id === registryId)
    if (!server) throw new Error(`paired server ${registryId} not found`)
    const token = await getServerSessionToken(registryId)
    if (!token) throw new Error(`no session token for paired server ${registryId}`)
    const link = new RPCLink({
      url: server.baseUrl,
      headers: () => ({ authorization: `Bearer ${token}` }),
    })
    return createORPCClient<AppClient>(link)
  })()
  pairedRpcClients.set(registryId, promise)
  return promise
}

// terminalId → paired-server registry id (client-db row id).
const terminalOwnership = new Map<string, string>()

/**
 * Paired-pod render scopes. Key: an opaque scopeKey (usually the
 * namespaced podId). Value: the paired registryId the pod belongs to.
 *
 * This is the *race-free* fallback path: `terminalOwnership` only gets
 * populated after `pod.listTerminals` / `pod.runningTerminals` resolve,
 * but `terminalRegistry.acquire()` captures a transport the *first*
 * time it sees a ptyInstanceId and never re-reads. If a child mounts
 * between initial render and query resolution (e.g. a zustand-cached
 * view pre-paints known podItems before their ptyInstanceIds are
 * registered), the local transport gets locked in and the paired WS
 * bridge is silent forever — only newly-created terminals work, the
 * pre-existing ones are dead.
 *
 * Pod-page registers its scope synchronously during render BEFORE any
 * child has a chance to acquire, so even the first-frame acquire hits
 * this map and routes to the paired bridge.
 */
const activeScopes = new Map<string, string>()

/**
 * Associate a terminal with a paired server so the TerminalRegistry can
 * route its reads/writes through the paired WS bridge. Call this BEFORE
 * the pod page's view tries to mount the terminal (i.e. on pod load
 * when `active.kind === 'remote'`).
 */
export function registerRemoteTerminal(terminalId: string, registryId: string): void {
  terminalOwnership.set(terminalId, registryId)
  // Warm the bridge so the first write/resize doesn't hit a cold socket.
  void getPairedTerminalBridge(registryId).catch((err) => {
    console.error('[terminal-transport] bridge warm-up failed', { registryId, err })
  })
}

/** Forget the association when the pod page unmounts. */
export function unregisterRemoteTerminal(terminalId: string): void {
  terminalOwnership.delete(terminalId)
}

/**
 * Announce that a paired pod is currently mounting terminals. Any child
 * that calls `getTransportFor(terminalId)` before its per-terminal
 * registration lands will fall through to the most recently-registered
 * scope and route to the paired bridge anyway. Safe to call repeatedly
 * with the same (scopeKey, registryId) — the scope is a simple map.
 */
export function registerRemotePodScope(scopeKey: string, registryId: string): void {
  if (activeScopes.get(scopeKey) === registryId) return
  activeScopes.set(scopeKey, registryId)
  void getPairedTerminalBridge(registryId)
    .then((bridge) => {
      installReconnectResync(registryId, bridge)
    })
    .catch((err) => {
      console.error('[terminal-transport] scope bridge warm-up failed', { registryId, err })
    })
}

/**
 * Keyed by registryId: the unsubscribe function for a single
 * `onReconnect` handler per paired bridge. We want exactly one handler
 * per bridge so a reconnect fires one resync per terminal, not N.
 */
const reconnectResyncInstalled = new Map<string, () => void>()

function installReconnectResync(registryId: string, bridge: { onReconnect(cb: () => void): () => void }): void {
  if (reconnectResyncInstalled.has(registryId)) return
  const off = bridge.onReconnect(() => {
    // Iterate a snapshot so resyncs running in parallel don't observe
    // in-flight ownership changes.
    const ids: string[] = []
    for (const [terminalId, rid] of terminalOwnership) {
      if (rid === registryId) ids.push(terminalId)
    }
    for (const terminalId of ids) {
      void terminalRegistry.resyncScrollback(terminalId).catch((err) => {
        console.error('[terminal-transport] resync after reconnect failed', {
          registryId,
          terminalId,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }

    // Drain any paired mutations that queued while the bridge was down.
    // Safe to call unconditionally — the outbox no-ops if there's nothing
    // pending for this registry.
    void drainPairedOutbox(registryId).catch((err) => {
      console.error('[terminal-transport] outbox drain after reconnect failed', {
        registryId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  })
  reconnectResyncInstalled.set(registryId, off)
}

export function unregisterRemotePodScope(scopeKey: string): void {
  activeScopes.delete(scopeKey)
}

/**
 * Resolve the effective registryId for a terminal: the explicit
 * terminal registration wins, otherwise fall back to any currently-
 * active pod scope. Exported only for testing + diagnostics.
 */
export function __resolveRegistryId(terminalId: string): string | null {
  const explicit = terminalOwnership.get(terminalId)
  if (explicit) return explicit
  // Any active scope works — pod pages don't nest. If multiple scopes
  // are active (e.g. during a fast navigation), the first one wins and
  // we re-route once the per-terminal entry lands.
  for (const registryId of activeScopes.values()) return registryId
  return null
}

/** Drop everything tied to a paired server — used when unpaired. */
export function forgetAllForServer(registryId: string): void {
  for (const [tid, rid] of terminalOwnership) {
    if (rid === registryId) terminalOwnership.delete(tid)
  }
  for (const [scope, rid] of activeScopes) {
    if (rid === registryId) activeScopes.delete(scope)
  }
  const off = reconnectResyncInstalled.get(registryId)
  if (off) {
    off()
    reconnectResyncInstalled.delete(registryId)
  }
  disposePairedTerminalBridge(registryId)
}

/**
 * Return the transport the TerminalRegistry should use for a given
 * terminal. Defaults to the local preload. If the terminal has been
 * registered as remote, returns a paired transport that lazily resolves
 * the underlying WS bridge (so construction doesn't block the caller).
 */
export function getTransportFor(terminalId: string): TerminalTransport {
  const registryId = __resolveRegistryId(terminalId)
  if (!registryId) return localTransport

  // Paired transport — all calls resolve the bridge lazily.
  return {
    write(id, data) {
      void getPairedTerminalBridge(registryId).then((b) => b.write(id, data))
    },
    resize(id, cols, rows) {
      void getPairedTerminalBridge(registryId).then((b) => b.resize(id, cols, rows))
    },
    onData(id, cb) {
      let off: (() => void) | null = null
      let cancelled = false
      void getPairedTerminalBridge(registryId).then((b) => {
        if (cancelled) return
        off = b.onData(id, cb)
      })
      return () => {
        cancelled = true
        off?.()
      }
    },
    onExit(id, cb) {
      let off: (() => void) | null = null
      let cancelled = false
      void getPairedTerminalBridge(registryId).then((b) => {
        if (cancelled) return
        off = b.onExit(id, cb)
      })
      return () => {
        cancelled = true
        off?.()
      }
    },
    async getScrollback(id) {
      try {
        const client = await getPairedRpcClient(registryId)
        const result = await client.terminal.getScrollback({ id })
        return (result ?? null) as string | null
      } catch (err) {
        console.error('[terminal-transport] paired getScrollback failed', {
          registryId,
          terminalId: id,
          error: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    },
    async clear(id) {
      try {
        const client = await getPairedRpcClient(registryId)
        await client.terminal.clear({ id })
      } catch (err) {
        console.error('[terminal-transport] paired clear failed', {
          registryId,
          terminalId: id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },
  }
}
