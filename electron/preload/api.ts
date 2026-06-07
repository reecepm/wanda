// -----------------------------------------------------------------------------
// `window.wanda` API factory.
//
// Pure function: takes a `PreloadTransport` and returns the full WandaAPI
// object. The transport handles all wire-level concerns (IPC vs WS). This
// factory is consumed by:
//
//   - The Electron preload script (electron/preload.ts) — wraps this with
//     an IPC-backed transport and exposes via contextBridge.
//   - The browser web entry (src/web-entry.ts) — wraps this with a WS-backed
//     transport and assigns to `window.wanda` directly.
//
// Adding a new API method means adding it here; both transports inherit
// the change automatically.
// -----------------------------------------------------------------------------

import type { BootstrapResult, PairedSessionSummary, WsTokenResult } from '../../shared/contracts/auth'
import type { ServerCapabilities } from '../../shared/contracts/capabilities'
import type { GitStatusEvent } from '../../shared/contracts/git-status'
import type { LocalPairingUrl, LocalServerInfo, PairedServerView } from '../../shared/contracts/servers'
import { log } from '../packages/logger'
import type { PreloadTransport, WandaEnv } from './transport'

export type {
  BootstrapResult,
  PairedSessionSummary,
  ServerCapabilities,
  WsTokenResult,
  LocalPairingUrl,
  LocalServerInfo,
  PairedServerView,
}

type TerminalDataCallback = (data: string) => void
type TerminalExitCallback = (code: number) => void
type TerminalZoomCallback = (direction: 'in' | 'out' | 'reset') => void
type TerminalUrlCallback = (streamId: string, url: string, podId: string | null) => void
type FileChangeCallback = (mtimeMs: number) => void

export function createWandaApi(transport: PreloadTransport) {
  // Keyed subscriptions: renderer code often wants "give me data for
  // terminal X only", so we maintain a local registry and demultiplex
  // the global channel on the transport side.
  const terminalDataSubscribers = new Map<string, Set<TerminalDataCallback>>()
  const terminalExitSubscribers = new Map<string, Set<TerminalExitCallback>>()
  const fileChangeSubscribers = new Map<string, Set<FileChangeCallback>>()
  const terminalZoomSubscribers = new Set<TerminalZoomCallback>()
  const terminalUrlSubscribers = new Set<TerminalUrlCallback>()

  // Wire the underlying transport channels once.
  transport.on('terminal:data', (...args) => {
    const [termId, data] = args as [string, string]
    const subs = terminalDataSubscribers.get(termId)
    if (!subs) return
    for (const cb of subs) cb(data)
  })

  transport.on('terminal:exit', (...args) => {
    const [termId, code] = args as [string, number]
    const subs = terminalExitSubscribers.get(termId)
    if (!subs) return
    for (const cb of subs) cb(code)
  })

  transport.on('terminal:zoom', (...args) => {
    const [direction] = args as ['in' | 'out' | 'reset']
    for (const cb of terminalZoomSubscribers) cb(direction)
  })

  transport.on('terminal:urlDetected', (...args) => {
    const [streamId, url, podId] = args as [string, string, string | null]
    for (const cb of terminalUrlSubscribers) cb(streamId, url, podId)
  })

  transport.on('file:changed', (...args) => {
    const [watchId, mtimeMs] = args as [string, number]
    const subs = fileChangeSubscribers.get(watchId)
    if (!subs) return
    for (const cb of subs) cb(mtimeMs)
  })

  return {
    /** Environment capability flags — see `WandaEnv`. */
    env: transport.env satisfies WandaEnv as WandaEnv,

    rpc: {
      call: (path: readonly string[], input: unknown) => transport.call(path, input),
    },

    /**
     * Return the HTTP base + bearer session token backing this transport,
     * for features that must hit raw HTTP endpoints outside oRPC (e.g.
     * fetching attachment blobs). Transports that don't speak HTTP return
     * `null`.
     */
    connection: {
      get: () => transport.getConnection?.() ?? null,
    },

    shell: {
      openExternal: (url: string) => transport.send('shell:openExternal', url),
    },

    terminal: {
      write: (id: string, data: string) => transport.send('terminal:write', id, data),
      resize: (id: string, cols: number, rows: number) => transport.send('terminal:resize', id, cols, rows),
      onData: (id: string, callback: TerminalDataCallback) => {
        let subs = terminalDataSubscribers.get(id)
        if (!subs) {
          subs = new Set()
          terminalDataSubscribers.set(id, subs)
        }
        subs.add(callback)
        return () => {
          subs.delete(callback)
          if (subs.size === 0) terminalDataSubscribers.delete(id)
        }
      },
      onExit: (id: string, callback: TerminalExitCallback) => {
        let subs = terminalExitSubscribers.get(id)
        if (!subs) {
          subs = new Set()
          terminalExitSubscribers.set(id, subs)
        }
        subs.add(callback)
        return () => {
          subs.delete(callback)
          if (subs.size === 0) terminalExitSubscribers.delete(id)
        }
      },
      onZoom: (callback: TerminalZoomCallback) => {
        terminalZoomSubscribers.add(callback)
        return () => {
          terminalZoomSubscribers.delete(callback)
        }
      },
      onUrlDetected: (callback: TerminalUrlCallback) => {
        terminalUrlSubscribers.add(callback)
        return () => {
          terminalUrlSubscribers.delete(callback)
        }
      },
    },

    pod: {
      onStatusChange: (callback: (podId: string, status: string) => void) =>
        transport.on('pod:status', (podId, status) => callback(podId as string, status as string)),
      onRecovered: (callback: (info: { recovered: number; failed: number; wasDirty: boolean }) => void) =>
        transport.on('pod:recovered', (info) =>
          callback(info as { recovered: number; failed: number; wasDirty: boolean }),
        ),
    },

    workenv: {
      onCreated: (callback: (id: string) => void) => transport.on('workenv.created', (id) => callback(id as string)),
      onUpdated: (callback: (id: string) => void) => transport.on('workenv.updated', (id) => callback(id as string)),
      onDestroyed: (callback: (id: string) => void) =>
        transport.on('workenv.destroyed', (id) => callback(id as string)),
      onStateChanged: (callback: (id: string, from: string, to: string) => void) =>
        transport.on('workenv.state.changed', (id, from, to) => callback(id as string, from as string, to as string)),
      onBootstrapProgress: (
        callback: (id: string, stepIndex: number, stepName: string, status: 'started' | 'succeeded' | 'failed') => void,
      ) =>
        transport.on('workenv.bootstrap.progress', (id, stepIndex, stepName, status) =>
          callback(id as string, stepIndex as number, stepName as string, status as 'started' | 'succeeded' | 'failed'),
        ),
      onPrebuildProgress: (
        callback: (
          templateId: string,
          hash: string,
          stepIndex: number,
          stepName: string,
          status: 'started' | 'succeeded' | 'failed',
        ) => void,
      ) =>
        transport.on('workenv.prebuild.progress', (templateId, hash, stepIndex, stepName, status) =>
          callback(
            templateId as string,
            hash as string,
            stepIndex as number,
            stepName as string,
            status as 'started' | 'succeeded' | 'failed',
          ),
        ),
      onPrebuildLog: (callback: (templateId: string, hash: string, chunk: string) => void) =>
        transport.on('workenv.prebuild.log', (templateId, hash, chunk) =>
          callback(templateId as string, hash as string, chunk as string),
        ),
      onHealth: (callback: (id: string, ok: boolean) => void) =>
        transport.on('workenv.health', (id, ok) => callback(id as string, ok as boolean)),
      onEventAdded: (callback: (id: string, type: string) => void) =>
        transport.on('workenv.event.added', (id, type) => callback(id as string, type as string)),
      onPortsChanged: (callback: (id: string) => void) =>
        transport.on('workenv.ports.changed', (id) => callback(id as string)),
    },

    git: {
      watchRepo: (repoPath: string) => transport.send('git:watch', repoPath),
      /**
       * Subscribe to unified git-status events pushed by the server's
       * `GitStatusBroadcaster`. The callback receives every event for every
       * pod; the caller is responsible for filtering by `podId`. Returns an
       * unsubscribe function.
       */
      onStatusChange: (callback: (event: GitStatusEvent) => void) =>
        transport.on('git:status', (event) => callback(event as GitStatusEvent)),
    },

    file: {
      watch: (watchId: string, podId: string, relPath: string) => transport.send('file:watch', watchId, podId, relPath),
      unwatch: (watchId: string) => transport.send('file:unwatch', watchId),
      onChange: (watchId: string, callback: FileChangeCallback) => {
        let subs = fileChangeSubscribers.get(watchId)
        if (!subs) {
          subs = new Set()
          fileChangeSubscribers.set(watchId, subs)
        }
        subs.add(callback)
        return () => {
          subs.delete(callback)
          if (subs.size === 0) fileChangeSubscribers.delete(watchId)
        }
      },
    },

    notification: {
      onChanged: (callback: () => void) => transport.on('notifications:changed', () => callback()),
    },

    orpc: {
      onInvalidate: (callback: (namespace: string, method: string) => void) =>
        transport.on('orpc:invalidate', (namespace, method) => callback(namespace as string, method as string)),
    },

    shortcut: {
      onForward: (callback: (binding: string, shift: boolean, alt: boolean) => void) =>
        transport.on('shortcut:forward', (binding, shift, alt) =>
          callback(binding as string, shift as boolean, alt as boolean),
        ),
    },

    /**
     * Per-session WS subscription for the UI-centric agents subsystem.
     * Issues `sys:subscribe { kind: 'agent-session', scope: sessionId }`
     * on attach and `sys:unsubscribe` on dispose, plus demuxes the single
     * `event:agentSession:event` channel by `resourceId` so only the right
     * session's listener fires.
     */
    agentSession: {
      subscribe: (
        sessionId: string,
        onEnvelope: (payload: unknown, seq: number) => void,
        options?: { replayFromSeq?: number },
      ) => {
        log.agent.debug('preload.api:agentSession.subscribe', { sessionId })
        const requestId = `agent-session:${sessionId}:${Math.random().toString(36).slice(2)}`
        const replayRequestId = `agent-session:replay:${sessionId}:${Math.random().toString(36).slice(2)}`
        let subscriptionId: string | null = null
        let replaying = false
        let replayUpToSeq: number | null = null
        const replayBuffer: Array<{ payload: unknown; seq: number }> = []
        const sendSubscribe = (): void => {
          log.agent.debug('preload.api:agentSession.send-subscribe', { sessionId, requestId })
          transport.send('sys:subscribe', {
            kind: 'agent-session',
            scope: sessionId,
            requestId,
          })
        }
        const channelListener = (raw: unknown): void => {
          const row = raw as { resourceId: string; payload: unknown; seq: number }
          if (!row || row.resourceId !== sessionId) return
          const payload = row.payload as { event?: { kind?: unknown } } | undefined
          log.agent.debug('preload.api:agentSession.deliver', {
            sessionId,
            seq: row.seq,
            kind: payload?.event?.kind,
          })
          if (replaying && replayUpToSeq != null && row.seq > replayUpToSeq) {
            replayBuffer.push({ payload: row.payload, seq: row.seq })
            return
          }
          onEnvelope(row.payload, row.seq)
        }
        const unsubLocal = transport.on('event:agentSession:event', channelListener)
        const unsubAck = transport.on('sys:subscribed', (raw) => {
          const ack = raw as { subscriptionId?: unknown; requestId?: unknown; snapshotSeq?: unknown } | undefined
          if (!ack || ack.requestId !== requestId || typeof ack.subscriptionId !== 'string') return
          subscriptionId = ack.subscriptionId
          if (typeof options?.replayFromSeq === 'number' && typeof ack.snapshotSeq === 'number') {
            const epoch = transport.getServerEpoch?.()
            if (epoch != null) {
              replayUpToSeq = ack.snapshotSeq
              replaying = true
              replayBuffer.length = 0
              transport.send('sys:replay-from-scoped', {
                sinceSeq: options.replayFromSeq,
                sinceEpoch: epoch,
                upToSeq: ack.snapshotSeq,
                requestId: replayRequestId,
                scope: { kind: 'agentSession', id: sessionId },
              })
            }
          }
          log.agent.debug('preload.api:agentSession.subscribed', {
            sessionId,
            requestId,
            subscriptionId,
          })
        })
        const finishReplay = (): void => {
          replaying = false
          replayUpToSeq = null
          replayBuffer.sort((a, b) => a.seq - b.seq)
          for (const row of replayBuffer.splice(0)) {
            onEnvelope(row.payload, row.seq)
          }
        }
        const unsubReplayComplete = transport.on('sys:replay-complete', (raw) => {
          const ack = raw as { requestId?: unknown } | undefined
          if (!ack || ack.requestId !== replayRequestId) return
          finishReplay()
        })
        const unsubReplayGone = transport.on('sys:replay-gone', (raw) => {
          const ack = raw as { requestId?: unknown } | undefined
          if (!ack || ack.requestId !== replayRequestId) return
          finishReplay()
        })
        const unsubReady = transport.on('wanda:ready', () => {
          if (disposed) return
          subscriptionId = null
          replaying = false
          replayUpToSeq = null
          replayBuffer.length = 0
          log.agent.debug('preload.api:agentSession.transport-ready', { sessionId })
          sendSubscribe()
        })
        let disposed = false
        void transport
          .waitForReady()
          .then(() => {
            if (disposed) return
            sendSubscribe()
          })
          .catch(() => {
            /* best-effort */
          })
        return () => {
          if (disposed) return
          disposed = true
          try {
            unsubLocal()
          } catch {
            /* best-effort */
          }
          try {
            unsubAck()
          } catch {
            /* best-effort */
          }
          try {
            unsubReady()
          } catch {
            /* best-effort */
          }
          try {
            unsubReplayComplete()
          } catch {
            /* best-effort */
          }
          try {
            unsubReplayGone()
          } catch {
            /* best-effort */
          }
          try {
            if (subscriptionId) {
              log.agent.debug('preload.api:agentSession.unsubscribe', {
                sessionId,
                subscriptionId,
              })
              transport.send('sys:unsubscribe', { subscriptionId })
            }
          } catch {
            /* best-effort */
          }
        }
      },
      /**
       * Kick off per-resource backfill. The server streams
       * `event:agentSession:event` envelopes for the scope, ending with
       * `sys:replay-complete`. The caller's `subscribe()` listener
       * receives the events — this just schedules the server-side replay.
       */
      replayFromScoped: (input: { sessionId: string; sinceSeq: number; sinceEpoch: number; upToSeq?: number }) => {
        transport.send('sys:replay-from-scoped', {
          sinceSeq: input.sinceSeq,
          sinceEpoch: input.sinceEpoch,
          upToSeq: input.upToSeq,
          scope: { kind: 'agentSession', id: input.sessionId },
        })
      },
      /**
       * Convenience wrapper that reads the current server epoch from the
       * transport and asks the server to replay everything from `sinceSeq`
       * forward. Returns `false` if the transport hasn't handshaken yet
       * (caller should retry after the next connect event). Used on
       * AgentSessionContainer mount so navigating away and back still
       * shows the full turn history instead of an empty chat.
       */
      replayForSession: (input: { sessionId: string; sinceSeq: number }): boolean => {
        const epoch = transport.getServerEpoch?.()
        if (epoch == null) return false
        log.agent.debug('preload.api:agentSession.replay', {
          sessionId: input.sessionId,
          sinceSeq: input.sinceSeq,
          epoch,
        })
        transport.send('sys:replay-from-scoped', {
          sinceSeq: input.sinceSeq,
          sinceEpoch: epoch,
          scope: { kind: 'agentSession', id: input.sessionId },
        })
        return true
      },
    },

    agent: {
      onMessage: (callback: (sessionId: string, msg: unknown) => void) =>
        transport.on('agent:message', (sessionId, msg) => callback(sessionId as string, msg)),
      onPermissionRequest: (
        callback: (req: {
          requestId: number
          type: string
          command?: string
          cwd?: string
          reason?: string
          grantRoot?: string
        }) => void,
      ) =>
        transport.on('agent:permission-request', (req) =>
          callback(
            req as {
              requestId: number
              type: string
              command?: string
              cwd?: string
              reason?: string
              grantRoot?: string
            },
          ),
        ),
      onPermissionResolved: (callback: () => void) => transport.on('agent:permission-resolved', () => callback()),
      onAuthRequired: (callback: (authUrl: string) => void) =>
        transport.on('agent:auth-required', (authUrl) => callback(authUrl as string)),
      onModelsLoaded: (callback: (models: { id: string; displayName: string; isDefault?: boolean }[]) => void) =>
        transport.on('agent:models-loaded', (models) =>
          callback(models as { id: string; displayName: string; isDefault?: boolean }[]),
        ),
      onReady: (callback: () => void) => transport.on('agent:ready', () => callback()),
      onStatusChange: (
        callback: (
          terminalId: string,
          status: {
            status: string
            agentType: string
            sessionId?: string
            errorDetail?: string
            exitCode?: number
            exitOutput?: string
          },
        ) => void,
      ) =>
        transport.on('agent:status', (terminalId, status) =>
          callback(
            terminalId as string,
            status as {
              status: string
              agentType: string
              sessionId?: string
              errorDetail?: string
              exitCode?: number
              exitOutput?: string
            },
          ),
        ),
    },

    tray: {
      navigate: (route: string, opts?: { focusPodId?: string; focusAgentId?: string }) =>
        transport.send('tray:navigate', route, opts),
      invalidate: (namespace: string, method: string) => transport.send('tray:invalidate', namespace, method),
    },

    /**
     * Client-side paired-servers registry. Electron-only — in browser
     * builds these calls reject because there's no `platformInvoke`
     * configured. The registry lives in the Electron main process and
     * owns encrypted session-token storage.
     */
    servers: {
      list: () => transport.invoke('servers:list') as Promise<PairedServerView[]>,
      pair: (pairingUrl: string) => transport.invoke('servers:pair', pairingUrl) as Promise<PairedServerView>,
      remove: (id: string) => transport.invoke('servers:remove', id) as Promise<void>,
      issueWsToken: (id: string) => transport.invoke('servers:issue-ws-token', id) as Promise<WsTokenResult>,
      capabilities: (id: string) => transport.invoke('servers:capabilities', id) as Promise<ServerCapabilities>,
      /**
       * Retrieve the decrypted session token for a paired server. Intended
       * for the renderer's per-server oRPC client factory — do not surface
       * the raw token in UI. Returns null for unknown ids.
       */
      getSessionToken: (id: string) => transport.invoke('servers:get-session-token', id) as Promise<string | null>,
      /**
       * Auto-heal a stale baseUrl. Call this when a paired-server fetch
       * fails with a network-level error (`ERR_CONNECTION_REFUSED`,
       * `Failed to fetch`); the main process probes the known hostname
       * on the Wanda default stable port and updates the stored baseUrl
       * if it finds the same `serverId`. Returns the new baseUrl on
       * success, `null` when the server can't be rediscovered.
       */
      probeAndHeal: (id: string) => transport.invoke('servers:probe-and-heal', id) as Promise<string | null>,
    },

    /**
     * Durable outbox for paired-server mutations. `enqueueAndFire` persists
     * the mutation, tries to fire it, and either returns the RPC result
     * (`ok: true`) or leaves the entry in the queue for retry (`ok: false`).
     * The renderer calls `drain(registryId)` when its paired bridge
     * reconnects so pending entries get another chance.
     */
    outbox: {
      enqueueAndFire: (registryId: string, method: string, input: unknown) =>
        transport.invoke('outbox:enqueue-and-fire', {
          registryId,
          method,
          input,
        }) as Promise<{
          ok: boolean
          outboxId: string
          result: unknown
          error: string | null
        }>,
      drain: (registryId: string) =>
        transport.invoke('outbox:drain', registryId) as Promise<
          Array<{ entryId: string; ok: boolean; error: string | null }>
        >,
      list: (registryId?: string) =>
        transport.invoke('outbox:list', registryId ?? null) as Promise<
          Array<{
            id: string
            registryId: string
            method: string
            input: unknown
            createdAt: number
            retries: number
            lastError: string | null
          }>
        >,
      remove: (id: string) => transport.invoke('outbox:remove', id) as Promise<boolean>,
    },

    /**
     * The embedded server that ships with this Electron app. Exposes bind
     * info + a pairing-URL minter so the Machines page can surface how
     * other machines should pair into THIS instance. Null when running in
     * subprocess mode (pairing info lives inside the child process).
     */
    localServer: {
      info: () => transport.invoke('local-server:info') as Promise<LocalServerInfo | null>,
      issuePairingUrl: () => transport.invoke('local-server:issue-pairing-url') as Promise<LocalPairingUrl | null>,
      incomingSessions: () => transport.invoke('local-server:incoming-sessions') as Promise<PairedSessionSummary[]>,
      revokeIncomingSession: (sessionId: string) =>
        transport.invoke('local-server:revoke-incoming-session', sessionId) as Promise<boolean>,
    },

    app: {
      onNavigate: (callback: (route: string, opts?: { focusPodId?: string; focusAgentId?: string }) => void) =>
        transport.on('app:navigate', (route, opts) =>
          callback(route as string, opts as { focusPodId?: string; focusAgentId?: string } | undefined),
        ),
      waitForServicesReady: () => transport.waitForReady(),
      /**
       * Subscribe to connection lifecycle events. The callback fires
       * whenever the underlying transport transitions between
       * 'connecting' / 'connected' / 'reconnecting' / 'disconnected'.
       * Renderer code uses this to drive a visible reconnect indicator.
       */
      onConnectionStatus: (callback: (status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void) =>
        transport.on('wanda:connection', (status) =>
          callback(status as 'connecting' | 'connected' | 'reconnecting' | 'disconnected'),
        ),
      /**
       * Subscribe to `shell:reconnect` — fired by the Electron shell
       * when the server subprocess restarts after a crash. The renderer
       * should invalidate its TanStack Query cache in response.
       */
      onShellReconnect: (callback: () => void) => transport.on('shell:reconnect', () => callback()),
      attentionPresent: () => transport.send('app:attention-present'),
      attentionDismiss: () => transport.send('app:attention-dismiss'),
    },
  } as const
}

export type WandaAPI = ReturnType<typeof createWandaApi>
