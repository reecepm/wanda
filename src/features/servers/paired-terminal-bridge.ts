// Per-paired-server terminal WS bridge.
//
// The local TerminalRegistry talks to the local server via
// `window.wanda.terminal.{onData,onExit,write,resize}`. When the pod the
// user is viewing lives on a paired remote server, those calls need to hit
// the REMOTE server's /events channel instead.
//
// Internals delegate full WS lifecycle — hello handshake, reconnect
// backoff, replay recovery — to `@wanda/client-connection.ClientConnection`.
// This file adds the bridge-specific pieces:
//   - per-terminal `onData` / `onExit` subscribers keyed by ptyInstanceId
//   - a broadcast `onInvalidate` callback for `orpc:invalidate` envelopes
//   - `onReconnect` callbacks so subscribers can refetch scrollback after
//     a resume whose replay can't repaint xterm cells
//   - a reject-delete-on-failure cache so a transient pair-up failure
//     doesn't poison subsequent bridge lookups with a dead promise

import { ClientConnection, type ConnectionState } from '@wanda/client-connection'
import { type Envelope, makeEnvelope } from '@wanda/wire'
import { issueServerWsToken, listPairedServers } from './use-servers'

export type PairedConnectionStatus = ConnectionState

export interface PairedTerminalBridge {
  write(terminalId: string, data: string): void
  resize(terminalId: string, cols: number, rows: number): void
  onData(terminalId: string, cb: (data: string) => void): () => void
  onExit(terminalId: string, cb: (code: number) => void): () => void
  subscribeAgentSession(
    sessionId: string,
    cb: (payload: unknown, seq: number) => void,
    options?: { replayFromSeq?: number },
  ): () => void
  replayAgentSession(input: { sessionId: string; sinceSeq: number }): boolean
  onInvalidate(cb: (namespace: string, method: string) => void): () => void
  /**
   * Fired after the bridge successfully (re)connects. Subscribers can
   * use this to resync state the server-side buffer can't replay —
   * e.g. refetch terminal scrollback to repaint what was on screen
   * while the connection was down.
   */
  onReconnect(cb: () => void): () => void
  /**
   * Emits the underlying `ClientConnection` state on every transition
   * and once immediately with the current state on subscription.
   */
  onStatus(cb: (state: PairedConnectionStatus) => void): () => void
  getStatus(): PairedConnectionStatus
  retain(): void
  release(): void
  dispose(): void
}

interface BridgeEntry {
  promise: Promise<PairedTerminalBridge>
  bridge: PairedTerminalBridge | null
}

const cache = new Map<string, BridgeEntry>()

export function getPairedTerminalBridge(registryId: string): Promise<PairedTerminalBridge> {
  const existing = cache.get(registryId)
  if (existing) return existing.promise
  const entry: BridgeEntry = { promise: createBridge(registryId), bridge: null }
  entry.promise.then(
    (b) => {
      entry.bridge = b
      notifyBridgeCacheChange()
    },
    () => {
      cache.delete(registryId)
      notifyBridgeCacheChange()
    },
  )
  cache.set(registryId, entry)
  return entry.promise
}

export function disposePairedTerminalBridge(registryId: string): void {
  const entry = cache.get(registryId)
  if (!entry) return
  entry.bridge?.dispose()
  cache.delete(registryId)
  notifyBridgeCacheChange()
}

/**
 * List registryIds whose bridge has finished handshaking and is live.
 * Consumers (like the connection-status indicator) use this to subscribe
 * only to bridges the user is actually using, not every paired entry in
 * the registry.
 */
export function listActivePairedBridges(): Array<{ registryId: string; bridge: PairedTerminalBridge }> {
  const out: Array<{ registryId: string; bridge: PairedTerminalBridge }> = []
  for (const [registryId, entry] of cache) {
    if (entry.bridge) out.push({ registryId, bridge: entry.bridge })
  }
  return out
}

/**
 * Subscribe to bridge cache changes — fires on every bridge add/remove,
 * letting consumers re-scan `listActivePairedBridges()` to pick up new
 * entries. Needed because lazy bridge creation means the set of active
 * bridges grows over time.
 */
const bridgeCacheSubs = new Set<() => void>()

export function onPairedBridgeCacheChange(cb: () => void): () => void {
  bridgeCacheSubs.add(cb)
  return () => {
    bridgeCacheSubs.delete(cb)
  }
}

function notifyBridgeCacheChange(): void {
  for (const cb of bridgeCacheSubs) {
    try {
      cb()
    } catch (err) {
      console.error('[paired-bridge] cache-change sub threw', err)
    }
  }
}

async function createBridge(registryId: string): Promise<PairedTerminalBridge> {
  // Subscription state — persists across WS reconnects. We never clear
  // these on a socket flap; callers would have to re-subscribe otherwise.
  const dataSubs = new Map<string, Set<(data: string) => void>>()
  const exitSubs = new Map<string, Set<(code: number) => void>>()
  const agentSessionSubs = new Map<string, Set<(payload: unknown, seq: number) => void>>()
  const agentSessionSubscriptionIds = new Map<string, string>()
  const agentSessionReplayFromByRequest = new Map<string, number>()
  const agentSessionReplayState = new Map<
    string,
    { replayRequestId: string; upToSeq: number; buffer: Array<{ payload: unknown; seq: number }> }
  >()
  const invalidateSubs = new Set<(namespace: string, method: string) => void>()
  const reconnectSubs = new Set<() => void>()
  const statusSubs = new Set<(state: PairedConnectionStatus) => void>()
  let status: PairedConnectionStatus = 'idle'

  let disposed = false
  let refCount = 0
  let serverEpoch: number | null = null

  async function resolveWsUrl(): Promise<string> {
    // The baseUrl can change between connects (local port-heal). Always
    // ask the registry rather than cache.
    const servers = await listPairedServers()
    const server = servers.find((s) => s.id === registryId)
    if (!server) throw new Error(`paired server ${registryId} not found`)
    return `${server.baseUrl.replace(/^http/, 'ws')}/events`
  }

  async function mintWsToken(): Promise<string> {
    const result = await issueServerWsToken(registryId)
    return result.wsToken
  }

  function dispatchEnvelope(env: Envelope): void {
    if (env.channel === 'terminal:data') {
      const [termId, data] = env.args as [string, string]
      const subs = dataSubs.get(termId)
      if (subs) for (const cb of subs) cb(data)
    } else if (env.channel === 'terminal:exit') {
      const [termId, code] = env.args as [string, number]
      const subs = exitSubs.get(termId)
      if (subs) for (const cb of subs) cb(code)
    } else if (env.channel === 'orpc:invalidate') {
      const [namespace, method] = env.args as [string, string]
      for (const cb of invalidateSubs) cb(namespace, method)
    } else if (env.channel === 'event:agentSession:event') {
      const row = env.args[0] as { resourceId?: unknown; payload?: unknown; seq?: unknown } | undefined
      if (!row || typeof row.resourceId !== 'string' || typeof row.seq !== 'number') return
      const subs = agentSessionSubs.get(row.resourceId)
      const replay = agentSessionReplayState.get(row.resourceId)
      if (replay && row.seq > replay.upToSeq) {
        replay.buffer.push({ payload: row.payload, seq: row.seq })
        return
      }
      if (subs) for (const cb of subs) cb(row.payload, row.seq)
    } else if (env.channel === 'sys:subscribed') {
      const ack = env.args[0] as { subscriptionId?: unknown; requestId?: unknown; snapshotSeq?: unknown } | undefined
      if (
        !ack ||
        typeof ack.subscriptionId !== 'string' ||
        typeof ack.requestId !== 'string' ||
        !ack.requestId.startsWith('agent-session:')
      ) {
        return
      }
      const sessionId = ack.requestId.slice('agent-session:'.length).split(':')[0]
      if (sessionId) agentSessionSubscriptionIds.set(sessionId, ack.subscriptionId)
    } else if (env.channel === 'sys:replay-complete' || env.channel === 'sys:replay-gone') {
      const ack = env.args[0] as { requestId?: unknown; scope?: { id?: unknown } } | undefined
      if (!ack || typeof ack.requestId !== 'string' || !ack.requestId.startsWith('agent-session:replay:')) return
      const sessionId =
        typeof ack.scope?.id === 'string'
          ? ack.scope.id
          : ack.requestId.slice('agent-session:replay:'.length).split(':')[0]
      if (sessionId) finishAgentSessionReplay(sessionId)
    }
  }

  function subscribeAgentSessionOnWire(sessionId: string, options?: { replayFromSeq?: number }): void {
    const requestId = `agent-session:${sessionId}:${Math.random().toString(36).slice(2)}`
    if (typeof options?.replayFromSeq === 'number') {
      agentSessionReplayFromByRequest.set(requestId, options.replayFromSeq)
    }
    conn.send(
      makeEnvelope('sys:subscribe', [
        {
          kind: 'agent-session',
          scope: sessionId,
          requestId,
        },
      ]),
    )
  }

  function requestAgentSessionReplay(sessionId: string, snapshotSeq: number, replayFromSeq: number): void {
    if (serverEpoch == null) return
    const replayRequestId = `agent-session:replay:${sessionId}:${Math.random().toString(36).slice(2)}`
    agentSessionReplayState.set(sessionId, {
      replayRequestId,
      upToSeq: snapshotSeq,
      buffer: [],
    })
    conn.send(
      makeEnvelope('sys:replay-from-scoped', [
        {
          sinceSeq: replayFromSeq,
          sinceEpoch: serverEpoch,
          upToSeq: snapshotSeq,
          requestId: replayRequestId,
          scope: { kind: 'agentSession', id: sessionId },
        },
      ]),
    )
  }

  function finishAgentSessionReplay(sessionId: string): void {
    const replay = agentSessionReplayState.get(sessionId)
    if (!replay) return
    agentSessionReplayState.delete(sessionId)
    const subs = agentSessionSubs.get(sessionId)
    if (!subs) return
    replay.buffer.sort((a, b) => a.seq - b.seq)
    for (const row of replay.buffer) {
      for (const cb of subs) cb(row.payload, row.seq)
    }
  }

  function resubscribeAgentSessions(): void {
    agentSessionSubscriptionIds.clear()
    agentSessionReplayState.clear()
    agentSessionReplayFromByRequest.clear()
    for (const sessionId of agentSessionSubs.keys()) subscribeAgentSessionOnWire(sessionId)
  }

  let resolveReady: (() => void) | null = null
  let rejectReady: ((err: unknown) => void) | null = null
  const firstReady = new Promise<void>((res, rej) => {
    resolveReady = res
    rejectReady = rej
  })
  let settled = false

  const conn = new ClientConnection({
    clientId: `paired-bridge-${registryId}`,
    getUrl: () => resolveWsUrl(),
    issueWsToken: () => mintWsToken(),
    // Paired bridges don't replay via EventLog — they refetch scrollback
    // on `onReconnect` instead. Report an empty cursor forever.
    getResumeCursor: () => ({ seq: 0, epoch: null }),
    onHelloAck: (ack) => {
      serverEpoch = ack.epoch
    },
    onSubscribed: (env) => {
      const ack = env.args[0] as { requestId?: unknown; snapshotSeq?: unknown } | undefined
      if (
        ack &&
        typeof ack.requestId === 'string' &&
        ack.requestId.startsWith('agent-session:') &&
        !ack.requestId.startsWith('agent-session:replay:')
      ) {
        const sessionId = ack.requestId.slice('agent-session:'.length).split(':')[0]
        const replayFromSeq = agentSessionReplayFromByRequest.get(ack.requestId)
        agentSessionReplayFromByRequest.delete(ack.requestId)
        if (sessionId && typeof ack.snapshotSeq === 'number' && typeof replayFromSeq === 'number') {
          requestAgentSessionReplay(sessionId, ack.snapshotSeq, replayFromSeq)
        }
      }
      dispatchEnvelope(env)
    },
    onReplayComplete: dispatchEnvelope,
    onReplayGone: dispatchEnvelope,
    onEventEnvelope: dispatchEnvelope,
    onLegacyEnvelope: dispatchEnvelope,
    onFullResyncNeeded: async () => {
      // No cache to blow away — paired subscribers re-sync via onReconnect.
    },
    onStateChange: (next) => {
      status = next
      for (const cb of statusSubs) {
        try {
          cb(next)
        } catch (err) {
          console.error('[paired-bridge] onStatus sub threw', err)
        }
      }
    },
    onReady: () => {
      if (!settled) {
        settled = true
        resolveReady?.()
      }
      resubscribeAgentSessions()
      for (const cb of reconnectSubs) {
        try {
          cb()
        } catch (err) {
          console.error('[paired-bridge] onReconnect sub threw', err)
        }
      }
    },
    onHelloRejected: (reason) => {
      if (!settled) {
        settled = true
        rejectReady?.(new Error(`paired hello rejected: ${reason}`))
      }
    },
  })
  conn.start()

  // Block until the first onReady. Caller awaits `getPairedTerminalBridge`
  // and expects a live bridge back — if the initial connect never happens
  // we still need to fail visibly rather than return a half-dead bridge.
  await firstReady

  const bridge: PairedTerminalBridge = {
    write(terminalId, data) {
      conn.send(makeEnvelope('terminal:write', [terminalId, data]))
    },
    resize(terminalId, cols, rows) {
      conn.send(makeEnvelope('terminal:resize', [terminalId, cols, rows]))
    },
    onData(terminalId, cb) {
      let subs = dataSubs.get(terminalId)
      if (!subs) {
        subs = new Set()
        dataSubs.set(terminalId, subs)
      }
      subs.add(cb)
      return () => {
        subs.delete(cb)
        if (subs.size === 0) dataSubs.delete(terminalId)
      }
    },
    onExit(terminalId, cb) {
      let subs = exitSubs.get(terminalId)
      if (!subs) {
        subs = new Set()
        exitSubs.set(terminalId, subs)
      }
      subs.add(cb)
      return () => {
        subs.delete(cb)
        if (subs.size === 0) exitSubs.delete(terminalId)
      }
    },
    subscribeAgentSession(sessionId, cb, options) {
      let subs = agentSessionSubs.get(sessionId)
      if (!subs) {
        subs = new Set()
        agentSessionSubs.set(sessionId, subs)
        subscribeAgentSessionOnWire(sessionId, options)
      }
      subs.add(cb)
      return () => {
        const current = agentSessionSubs.get(sessionId)
        if (!current) return
        current.delete(cb)
        if (current.size > 0) return
        agentSessionSubs.delete(sessionId)
        const subscriptionId = agentSessionSubscriptionIds.get(sessionId)
        agentSessionSubscriptionIds.delete(sessionId)
        if (subscriptionId) conn.send(makeEnvelope('sys:unsubscribe', [{ subscriptionId }]))
      }
    },
    replayAgentSession(input) {
      if (serverEpoch == null) return false
      conn.send(
        makeEnvelope('sys:replay-from-scoped', [
          {
            sinceSeq: input.sinceSeq,
            sinceEpoch: serverEpoch,
            scope: { kind: 'agentSession', id: input.sessionId },
          },
        ]),
      )
      return true
    },
    onInvalidate(cb) {
      invalidateSubs.add(cb)
      return () => {
        invalidateSubs.delete(cb)
      }
    },
    onReconnect(cb) {
      reconnectSubs.add(cb)
      return () => {
        reconnectSubs.delete(cb)
      }
    },
    onStatus(cb) {
      statusSubs.add(cb)
      try {
        cb(status)
      } catch (err) {
        console.error('[paired-bridge] onStatus initial emit threw', err)
      }
      return () => {
        statusSubs.delete(cb)
      }
    },
    getStatus() {
      return status
    },
    retain() {
      refCount++
    },
    release() {
      refCount = Math.max(0, refCount - 1)
    },
    dispose() {
      if (disposed) return
      disposed = true
      dataSubs.clear()
      exitSubs.clear()
      agentSessionSubs.clear()
      agentSessionSubscriptionIds.clear()
      agentSessionReplayState.clear()
      agentSessionReplayFromByRequest.clear()
      invalidateSubs.clear()
      reconnectSubs.clear()
      statusSubs.clear()
      void conn.stop()
      cache.delete(registryId)
    },
  }
  return bridge
}
