// -----------------------------------------------------------------------------
// WebSocket-backed PreloadTransport.
//
// Owns: oRPC HTTP client, per-channel listener registry, and send routing
// for legacy shell channels. Delegates every bit of the WS lifecycle (mint
// wsToken → open → hello → replay → reconnect) to
// `@wanda/client-connection.ClientConnection`. The renderer's `PreloadTransport`
// surface (env, call, send, invoke, on, waitForReady, dispatch) stays
// unchanged — only the internals have moved into the package.
// -----------------------------------------------------------------------------
//
// Chromium warmup race: the first `fetch()` from the Electron preload
// reliably fails with "TypeError: Failed to fetch" before the renderer's
// network service is done initialising. `mintWsToken` retries 4× with
// 30 ms backoff to absorb this; `ClientConnection` consumes whatever our
// thunk eventually returns.
// -----------------------------------------------------------------------------

import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { ClientConnection } from '@wanda/client-connection'
import type { Envelope } from '@wanda/wire'
import { makeEnvelope } from '@wanda/wire'
import type { AppClient } from '../../shared/contracts/router'
import { log } from '../packages/logger'
import type { PreloadTransport, WandaEnv } from './transport'

export interface WsTransportConfig {
  readonly httpUrl: string
  readonly wsUrl: string
  /**
   * Long-lived bearer session token. Used verbatim as the Authorization
   * header for every oRPC HTTP call, and swapped for a short-lived wsToken
   * before each WebSocket upgrade via POST /api/auth/ws-token.
   */
  readonly sessionToken: string
  readonly platform: 'electron' | 'browser'
  readonly platformSend?: (channel: string, ...args: unknown[]) => void
  readonly platformInvoke?: (channel: string, ...args: unknown[]) => Promise<unknown>
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export const CONNECTION_STATUS_CHANNEL = 'wanda:connection'
export const REPLAY_LOST_CHANNEL = 'wanda:replay-lost'

/**
 * Extended transport exposing `dispatch` so the Electron preload can feed
 * IPC-delivered local events (terminal:zoom, shortcut:forward, app:navigate)
 * into the listener registry. Pure browser clients never call `dispatch`.
 */
export interface WsTransportWithDispatch extends PreloadTransport {
  dispatch(channel: string, ...args: unknown[]): void
}

const CLIENT_ID = 'wanda-local-shell'

export function createWsTransport(config: WsTransportConfig): WsTransportWithDispatch {
  const env: WandaEnv = {
    platform: config.platform,
    transport: 'ws',
    canOpenExternal: config.platform === 'electron',
    hasTray: config.platform === 'electron',
    hasNativeDialogs: config.platform === 'electron',
    hasNativeMenu: config.platform === 'electron',
    hasGlobalShortcuts: config.platform === 'electron',
  }

  // oRPC HTTP client — authorized with the long-lived session token.
  const link = new RPCLink({
    url: config.httpUrl,
    headers: { authorization: `Bearer ${config.sessionToken}` },
  })
  const client = createORPCClient<AppClient>(link)

  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  function fireLocal(channel: string, ...args: unknown[]): void {
    const subs = listeners.get(channel)
    if (!subs) return
    for (const cb of subs) cb(...args)
  }

  // --- Connection status + readiness promise ---------------------------------

  let currentStatus: ConnectionStatus = 'connecting'
  function setStatus(next: ConnectionStatus): void {
    if (currentStatus === next) return
    currentStatus = next
    fireLocal(CONNECTION_STATUS_CHANNEL, next)
  }

  let isReady = false
  let resolveReady: () => void
  const readyPromise = new Promise<void>((r) => {
    resolveReady = r
  })

  // --- wsToken mint with Chromium warmup retry -------------------------------

  async function mintWsToken(): Promise<string> {
    const url = `${config.httpUrl}/api/auth/ws-token`
    let lastErr: unknown = null
    for (let i = 0; i < 4; i++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.sessionToken}` },
        })
        if (!res.ok) {
          throw new Error(`ws-token mint http ${res.status}`)
        }
        const body = (await res.json()) as { wsToken?: string }
        if (typeof body.wsToken !== 'string') throw new Error('ws-token mint missing wsToken field')
        return body.wsToken
      } catch (err) {
        lastErr = err
        // Attempt 0-2 swallowed as warmup noise; 3 reports the real problem.
        if (i === 3) {
          // eslint-disable-next-line no-console
          console.warn(
            `[wanda] ws-token mint error: url=${url} readyState=${typeof document !== 'undefined' ? document.readyState : 'n/a'} message=${err instanceof Error ? err.message : String(err)}`,
          )
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('ws-token mint failed')
  }

  // --- ClientConnection ------------------------------------------------------

  /** Highest event:* seq the store has applied, or 0 if nothing seen. */
  let lastSeenSeq = 0
  /** Server epoch for the last connection that completed replay/recovery. */
  let lastSeenEpoch: number | null = null
  /** Epoch from the latest hello-ack, promoted only after recovery is ready. */
  let pendingAckEpoch: number | null = null

  const conn = new ClientConnection({
    clientId: CLIENT_ID,
    getUrl: () => config.wsUrl,
    issueWsToken: () => mintWsToken(),
    getResumeCursor: () => ({ seq: lastSeenSeq, epoch: lastSeenEpoch }),
    onHelloAck: (ack) => {
      pendingAckEpoch = ack.epoch
      log.agent.debug('preload.ws:hello-ack', {
        serverSeq: ack.serverSeq,
        epoch: ack.epoch,
      })
    },
    onSubscribed: (envelope) => {
      log.agent.debug('preload.ws:subscribed', envelope.args[0])
      fireLocal('sys:subscribed', ...envelope.args)
    },
    onReplayComplete: (envelope) => {
      fireLocal('sys:replay-complete', ...envelope.args)
    },
    onReplayGone: (envelope) => {
      fireLocal('sys:replay-gone', ...envelope.args)
    },
    onEventEnvelope: (envelope: Envelope) => {
      if (typeof envelope.seq === 'number' && envelope.seq > lastSeenSeq) {
        lastSeenSeq = envelope.seq
      }
      if (envelope.channel === 'event:agentSession:event') {
        const row = envelope.args[0] as
          | {
              resourceId?: unknown
              seq?: unknown
              payload?: { event?: { kind?: unknown } }
            }
          | undefined
        log.agent.debug('preload.ws:event', {
          resourceId: row?.resourceId,
          seq: row?.seq,
          kind: row?.payload?.event?.kind,
        })
      }
      fireLocal(envelope.channel, ...envelope.args)
    },
    onLegacyEnvelope: (envelope: Envelope) => {
      fireLocal(envelope.channel, ...envelope.args)
    },
    onStateChange: (state) => {
      // Map the fine-grained FSM states onto the UI's four buckets.
      if (state === 'connected') {
        setStatus('connected')
        if (!isReady) {
          isReady = true
          resolveReady()
        }
      } else if (state === 'recovering' || state === 'connecting') {
        setStatus(isReady ? 'reconnecting' : 'connecting')
      } else if (state === 'reconnecting') {
        setStatus(isReady ? 'reconnecting' : 'connecting')
      } else if (state === 'offline' || state === 'unpaired' || state === 'stopped') {
        setStatus('disconnected')
      }
    },
    onReady: () => {
      if (pendingAckEpoch != null) lastSeenEpoch = pendingAckEpoch
      log.agent.debug('preload.ws:ready')
      fireLocal('wanda:ready')
    },
    onFullResyncNeeded: async () => {
      lastSeenSeq = 0
      lastSeenEpoch = null
      fireLocal(REPLAY_LOST_CHANNEL)
    },
  })

  // Defer the first connect until the renderer's network stack is warm.
  // In Electron preload, module load fires before the BrowserWindow's
  // network service has finished wiring up — if we synchronously kick off
  // a fetch here, `mintWsToken`'s first attempt eats the retry budget.
  function scheduleInitialConnect(): void {
    const doc = typeof document !== 'undefined' ? document : null
    if (doc && doc.readyState === 'loading') {
      const onReady = (): void => {
        doc.removeEventListener('DOMContentLoaded', onReady)
        conn.start()
      }
      doc.addEventListener('DOMContentLoaded', onReady, { once: true })
    } else {
      conn.start()
    }
  }
  scheduleInitialConnect()

  // --- send / invoke routing -------------------------------------------------

  const rpcClient = client as unknown as {
    terminal: {
      write: (input: { id: string; data: string }) => Promise<void>
      resize: (input: { id: string; cols: number; rows: number }) => Promise<void>
    }
    git: { watchRepo: (input: { repoPath: string }) => Promise<void> }
    file: {
      watch: (input: { watchId: string; podId: string; relPath: string }) => Promise<void>
      unwatch: (input: { watchId: string }) => Promise<void>
    }
  }

  const send: PreloadTransport['send'] = (channel, ...args) => {
    switch (channel) {
      case 'terminal:write': {
        const [id, data] = args as [string, string]
        conn.send(makeEnvelope('terminal:write', [id, data]))
        return
      }
      case 'terminal:resize': {
        const [id, cols, rows] = args as [string, number, number]
        conn.send(makeEnvelope('terminal:resize', [id, cols, rows]))
        return
      }
      case 'git:watch': {
        const [repoPath] = args as [string]
        void rpcClient.git.watchRepo({ repoPath }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[ws-transport] git.watchRepo failed:', { repoPath, err })
        })
        return
      }
      case 'file:watch': {
        const [watchId, podId, relPath] = args as [string, string, string]
        void rpcClient.file.watch({ watchId, podId, relPath }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[ws-transport] file.watch failed:', { watchId, podId, relPath, err })
        })
        return
      }
      case 'file:unwatch': {
        const [watchId] = args as [string]
        void rpcClient.file.unwatch({ watchId }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[ws-transport] file.unwatch failed:', { watchId, err })
        })
        return
      }
      case 'shell:openExternal': {
        const [url] = args as [string]
        if (typeof window !== 'undefined' && typeof window.open === 'function') {
          window.open(url, '_blank', 'noopener,noreferrer')
        }
        return
      }
      case 'sys:subscribe':
      case 'sys:unsubscribe': {
        log.agent.debug(`preload.ws:send:${channel}`, args[0])
        // Generic WS control messages — used by per-resource subscription
        // consumers (e.g. the agent-session bridge). Payload is passed
        // straight through as envelope args so the server's `handleMessage`
        // sees the same shape it would from any client.
        conn.send(makeEnvelope(channel, args))
        return
      }
      case 'sys:replay-from-scoped': {
        log.agent.debug('preload.ws:send:sys:replay-from-scoped', args[0])
        conn.send(makeEnvelope(channel, args))
        return
      }
      case 'tray:navigate':
      case 'tray:invalidate':
        return
      default:
        if (config.platformSend) {
          config.platformSend(channel, ...args)
          return
        }
        // eslint-disable-next-line no-console
        console.warn(`[wanda] ws-transport: unknown send channel "${channel}"`)
    }
  }

  const invoke: PreloadTransport['invoke'] = async (channel, ...args) => {
    if (channel === 'app:wait-services-ready') {
      await readyPromise
      return
    }
    if (config.platformInvoke) {
      return config.platformInvoke(channel, ...args)
    }
    throw new Error(`[wanda] ws-transport: unknown invoke channel "${channel}"`)
  }

  return {
    env,
    call: (path, input) => {
      let target: unknown = client
      for (const segment of path) {
        if (target == null || (typeof target !== 'object' && typeof target !== 'function')) {
          return Promise.reject(new Error(`oRPC path ${path.join('.')} is not navigable`))
        }
        target = (target as Record<string, unknown>)[segment]
      }
      if (typeof target !== 'function') {
        return Promise.reject(new Error(`oRPC path ${path.join('.')} is not callable`))
      }
      return (target as (input: unknown) => Promise<unknown>)(input)
    },
    send,
    invoke,
    on: (channel, listener) => {
      let subs = listeners.get(channel)
      if (!subs) {
        subs = new Set()
        listeners.set(channel, subs)
      }
      subs.add(listener)
      // New connection-status subscribers catch up to the current state so
      // indicators don't flash 'connecting' after the transport is already up.
      if (channel === CONNECTION_STATUS_CHANNEL) {
        queueMicrotask(() => {
          if (subs.has(listener)) listener(currentStatus)
        })
      }
      return () => {
        subs.delete(listener)
        if (subs.size === 0) listeners.delete(channel)
      }
    },
    waitForReady: () => readyPromise,
    dispatch: (channel, ...args) => {
      fireLocal(channel, ...args)
    },
    getConnection: () => ({ httpUrl: config.httpUrl, sessionToken: config.sessionToken }),
    getServerEpoch: () => lastSeenEpoch,
  }
}
