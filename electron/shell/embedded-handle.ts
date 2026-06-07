// -----------------------------------------------------------------------------
// Embedded server strategy.
//
// Wraps an in-process `createServerRuntime()` result. The factory wires the
// runtime's `broadcast` + `onNotificationsChanged` to an internally-created
// WsGateway so the renderer (and any other client) can connect via WebSocket
// to the in-process HTTP server, then composes the auth / attachment HTTP
// handlers and the agent runtime providers around it.
// -----------------------------------------------------------------------------

import { networkInterfaces, hostname as osHostname } from 'node:os'
import { eq } from 'drizzle-orm'
import type { PairedSessionSummary } from '../../shared/contracts/auth'
import type { ServerCapabilities } from '../../shared/contracts/capabilities'
import { pods, settings } from '../db/schema'
import { log } from '../packages/logger'
import { type AuthStore, createAuthHttpHandler, createInMemoryAuthStore } from '../server/auth'
import { ensureNonLoopbackAllowed } from '../server/bind-guard'
import { getOrCreateServerIdentity } from '../server/identity'
import { createServerRuntime, type ServerRuntimeHandle, type ServerRuntimeOpts } from '../server/runtime'
import { WsGateway } from '../server/ws-gateway'
import type { AppClient, ShellServerHandle } from './server-handle'

export interface EmbeddedOpts {
  /**
   * Partial server runtime options. The factory fills in `broadcast` and
   * `onNotificationsChanged` itself — they're wired to an internally-
   * created WsGateway so the renderer (and any other client) can connect
   * via WebSocket to the in-process HTTP server.
   */
  readonly runtimeOpts: Omit<
    ServerRuntimeOpts,
    'broadcast' | 'onNotificationsChanged' | 'extraHttpHandler' | 'authenticateRpc' | 'host' | 'port' | 'epoch'
  >
  /**
   * Called when any notification changes. The shell uses this to refresh
   * its dock badge / tray badge. Runs after the WsGateway has already
   * broadcast `notifications:changed` to connected clients.
   */
  readonly onNotificationsChanged?: () => void
  /**
   * App version — reported to paired clients via /api/capabilities so the
   * Machines page can display it and so pairing clients pin the right server.
   */
  readonly appVersion?: string
}

export interface LocalServerHandle {
  /** The bind host the embedded runtime is listening on. `127.0.0.1` for loopback, `0.0.0.0` for network-exposed. */
  readonly listenHost: string
  /** Resolved listen port. */
  readonly port: number
  /** Stable server id, echoed in /api/capabilities. */
  readonly serverId: string
  /** Short local hostname, used to suggest a reachable URL on the LAN/Tailnet. */
  readonly hostname: string
  /** Mint a fresh one-shot pairing token + its URL. Existing tokens remain valid. */
  readonly issuePairingUrl: () => { token: string; url: string; expiresAt: number }
  /** Non-loopback IPv4 addresses — best-effort list of reachable hosts for this machine. */
  readonly listNetworkHosts: () => string[]
  /** Devices that have paired INTO this server (incoming sessions). */
  readonly listIncomingSessions: () => PairedSessionSummary[]
  /** Revoke an incoming session (paired-in device). Returns true if the session existed. */
  readonly revokeIncomingSession: (sessionId: string) => boolean
}

function listIpv4Hosts(): string[] {
  const out: string[] = []
  const ifaces = networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address)
    }
  }
  return out
}

export async function createEmbeddedHandle(opts: EmbeddedOpts): Promise<{
  handle: ShellServerHandle
  runtime: ServerRuntimeHandle
  local: LocalServerHandle
  authStore: AuthStore
}> {
  // Pairing / session / ws-token store. Stable server id survives reboots
  // via the env override; otherwise a fresh one is minted per process.
  //
  // Resolve the DB BEFORE we create the AuthStore so session tokens can be
  // persisted across restarts. DatabaseService is a ManagedRuntime-cached
  // layer — this first resolution triggers `createDatabase(dbPath)`, and
  // the later `createServerRuntime()` call gets the same instance back.
  const { AppRuntime, DatabaseService } = await import('../services')
  const db = await AppRuntime.runPromise(DatabaseService)

  // E2E-only: allow tests to pre-mark the onboarding as complete so the
  // renderer boots straight into the main app. Kept behind an explicit env
  // var so it can never affect a shipped user's onboarding experience.
  if (process.env.WANDA_SKIP_ONBOARDING === '1') {
    const { settings } = await import('../db/schema')
    db.insert(settings)
      .values({ key: 'onboarding.completed', value: 'true', updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: 'true', updatedAt: new Date() },
      })
      .run()
  }

  // Persistent server identity — survives restarts so paired clients don't
  // see this machine as "new" every boot. Epoch bumps on every start; the
  // CRC seal detects torn writes on disk-full.
  const identity = getOrCreateServerIdentity(db)
  const serverId = identity.id
  const authStore = createInMemoryAuthStore(serverId, { db })

  // Local "main window" session — the shell's own BrowserWindows
  // (main + tray) use this like any other paired client: they present the
  // sessionToken over HTTP RPC and swap it for one-shot wsTokens before
  // each WS upgrade. No static per-boot token path remains.
  const localSession = authStore.createLocalSession({
    deviceName: `${osHostname()}-shell`,
    os: process.platform,
    appVersion: opts.appVersion ?? '0.0.0',
  })

  // onMessage is set after runtime creation (needs targetManager)
  let runtimeMessageHandler: ((channel: string, args: unknown[]) => void) | undefined
  const gateway = new WsGateway({
    authStore,
    serverId,
    epoch: identity.epoch,
    onMessage: (channel, args) => runtimeMessageHandler?.(channel, args),
  })

  // Default bind host: loopback. Override via WANDA_LISTEN_HOST (e.g. `0.0.0.0`
  // to accept pairings from other machines on the LAN / Tailnet). Bearer auth
  // still gates every RPC + WS upgrade — loopback is defense-in-depth only.
  const listenHost = process.env.WANDA_LISTEN_HOST ?? '127.0.0.1'

  // Port selection:
  //   - Loopback: ephemeral (0). The local renderer already has the
  //     runtime port handed to it via preload args — no external
  //     clients care what it is.
  //   - Network-exposed: default to a STABLE port (9876) so paired
  //     clients that saved this baseUrl keep working across restarts.
  //     Ephemeral ports change every run and strand every paired
  //     laptop with a dead URL. `WANDA_PORT` overrides explicitly
  //     (set to `0` to force ephemeral even when network-exposed, or
  //     to any specific number when 9876 collides with another app).
  //   - Port collision at bind time falls back to ephemeral + logs a
  //     warning — clients' auto-heal logic below will pick up the new
  //     port via hostname:<WANDA_DEFAULT_PORT> probing once we wire that.
  const DEFAULT_NETWORK_PORT = 9876
  const isLoopback = listenHost === '127.0.0.1' || listenHost === 'localhost'
  if (!isLoopback) {
    ensureNonLoopbackAllowed(listenHost)
  }
  const listenPortEnv = process.env.WANDA_PORT
  const requestedPort =
    listenPortEnv != null ? Number.parseInt(listenPortEnv, 10) : isLoopback ? 0 : DEFAULT_NETWORK_PORT

  // Build capability descriptor for /api/capabilities.
  const hostname = osHostname()
  const capabilities: ServerCapabilities = {
    serverId,
    hostname,
    appVersion: opts.appVersion ?? '0.0.0',
    ssh: null,
    features: {
      docker: true,
      agents: true,
      workspaceRoot: opts.runtimeOpts.snapshotStoreDir,
    },
  }

  const authHandler = createAuthHttpHandler({ store: authStore, capabilities })

  // Configure the attachment service base dir before the AppLayer resolves
  // (it reads through a singleton). Blobs land under <userData>/agent-
  // attachments and persist alongside event-log entries.
  const { configureAttachmentService, makeAttachmentHttpHandler } = await import('../domains/agent-attachment')
  const { join: joinPath } = await import('node:path')
  const attachmentBaseDir = joinPath(opts.runtimeOpts.snapshotStoreDir, 'agent-attachments')
  configureAttachmentService({ baseDir: attachmentBaseDir })

  // Compose the attachments HTTP handler on top of the auth handler so
  // `/attachments/:id` sits alongside `/api/auth/*`. First match wins.
  const attachmentsHandler = makeAttachmentHttpHandler({ authStore, appRuntime: AppRuntime })
  const combinedHttpHandler = async (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => {
    if (await authHandler(req, res)) return true
    if (await attachmentsHandler(req, res)) return true
    return false
  }

  // Shared runtime options used by both bind attempts.
  const buildRuntimeOpts = (port: number) => ({
    ...opts.runtimeOpts,
    host: listenHost,
    port,
    epoch: identity.epoch,
    // Spawned MCP servers authenticate their RPC calls with this token.
    mcpAuthToken: localSession.sessionToken,
    broadcast: gateway.broadcast,
    onNotificationsChanged: () => {
      gateway.broadcast('notifications:changed')
      opts.onNotificationsChanged?.()
    },
    extraHttpHandler: combinedHttpHandler,
    // All RPC callers (local windows AND paired clients) authenticate
    // with a session token minted through the AuthStore. Local windows
    // use the `localSession` created above; paired clients use the
    // result of their bootstrap flow.
    authenticateRpc: (req: import('node:http').IncomingMessage) => {
      const auth = req.headers.authorization
      if (!auth) return false
      const parts = auth.split(' ')
      if (parts.length !== 2 || parts[0] !== 'Bearer') return false
      const provided = parts[1] ?? ''
      return authStore.validateSession(provided) !== null
    },
  })

  // Try the requested (stable-by-default) port first. If it's busy,
  // fall back to ephemeral and log loudly — paired clients will need
  // to re-probe to heal. This lets the local app still boot.
  let runtime: ServerRuntimeHandle
  try {
    runtime = await createServerRuntime(buildRuntimeOpts(requestedPort))
  } catch (err) {
    if (requestedPort !== 0 && err instanceof Error && /EADDRINUSE|in use/i.test(err.message)) {
      log.main.warn(
        `port ${requestedPort} in use on ${listenHost}; falling back to ephemeral. ` +
          'Paired clients may fail to reconnect until they re-probe; set WANDA_PORT to a free stable port.',
      )
      runtime = await createServerRuntime(buildRuntimeOpts(0))
    } else {
      throw err
    }
  }

  // Wire terminal WS input handler now that runtime has targetManager
  runtimeMessageHandler = runtime.handleWsMessage

  // Wire the agent runtime. Mock always ships (for tests + no-key boot);
  // Codex direct resolves its API key lazily so rotation via the Settings UI
  // works without restart.
  const { configureAgentRuntimeDeps } = await import('../domains/agent-runtime')
  const { ensureDirectCodexHome } = await import('../domains/agent-runtime/codex-home')
  const { hasWandaMcpServer } = await import('../packages/agent-mcp')
  const { makeDrizzleSessionStore, makeDrizzlePendingPermissionsStore } = await import('../domains/chat-session')
  const { makeRuntimePermissionPolicyStore } = await import('../domains/permission-policy')
  const { mockProvider } = await import('@wanda/agent-runtime')
  const { codexDirectProvider } = await import('@wanda/agent-providers/codex')
  const { providerSecrets } = await import('../db/schema')
  const { decryptSecret } = await import('../infra/secret-store')
  const { blobPath } = await import('../domains/agent-attachment/storage')
  const { getAttachmentBaseDir, hasAttachmentConfig } = await import('../domains/agent-attachment/controller')

  const getStoredKey = (providerId: 'openai', envName: string): string | null => {
    try {
      const row = runtime.db.select().from(providerSecrets).where(eq(providerSecrets.providerId, providerId)).get()
      if (row) return decryptSecret(row.ciphertext)
    } catch (err) {
      log.main.warn(`Failed to read ${providerId} key from DB`, err)
    }
    const envKey = process.env[envName]
    return envKey && envKey.length > 0 ? envKey : null
  }
  const getOpenAiKey = (): string | null => getStoredKey('openai', 'OPENAI_API_KEY')

  configureAgentRuntimeDeps({
    eventLog: runtime.eventLog,
    subscriptions: gateway.subscriptionManager,
    providers: [
      mockProvider(),
      codexDirectProvider({
        env: (ctx) => ({
          CODEX_HOME: ensureDirectCodexHome(log.agent, {
            scopeId: String(ctx.sessionId),
            mcpPort: runtime.mcpPort,
            includeWandaMcp: hasWandaMcpServer(ctx.mcpServers),
          }),
        }),
        getApiKey: getOpenAiKey,
        resolveAttachmentPath: (ref) => {
          if (!hasAttachmentConfig()) return null
          try {
            return blobPath(getAttachmentBaseDir(), ref.sha256)
          } catch (err) {
            log.main.warn('resolveAttachmentPath(codex) failed; falling back to placeholder', err)
            return null
          }
        },
      }),
    ],
    sessionStore: makeDrizzleSessionStore(runtime.db),
    pendingPermissions: makeDrizzlePendingPermissionsStore(runtime.db),
    permissionPolicies: makeRuntimePermissionPolicyStore(runtime.db),
    logger: (message, ctx) => {
      log.agent.debug(message, ctx)
    },
  })

  // Boot drain: synthesize `deny` for any permission prompts that were left
  // hanging when the previous process exited. We emit `permission.resolved`
  // through the fanout BEFORE attaching the WS gateway, so when the first
  // client reconnects and backfills from the event log it already sees the
  // resolved counterpart and won't render a dead prompt.
  {
    const { Effect } = await import('effect')
    const { AgentRuntime } = await import('@wanda/agent-runtime')
    try {
      const drained = await AppRuntime.runPromise(Effect.flatMap(AgentRuntime, (r) => r.drainPendingPermissions()))
      if (drained > 0) {
        log.main.info(`drained ${drained} pending permission rows from prior process`)
      }
    } catch (err) {
      log.main.warn('drainPendingPermissions failed', err)
    }
  }

  // Attach the gateway AFTER the server binds so we know the actual port.
  gateway.attachTo(runtime.httpServer, runtime.eventLog)
  // Host allow-list is defense-in-depth for DNS rebinding. Only useful on
  // loopback deployments — when bound to a non-loopback address, paired
  // clients connect with arbitrary Host headers (hostname, IP, Tailscale
  // magic DNS, etc.) and bearer auth is the real guard.
  if (listenHost === '127.0.0.1' || listenHost === 'localhost') {
    gateway.setAllowedHosts([`127.0.0.1:${runtime.mcpPort}`, `localhost:${runtime.mcpPort}`])
  }

  // Preload + Electron windows always use loopback to reach the in-process
  // server, regardless of listenHost. They live in the same process. The
  // `token` field on `connection` is the local session token — the preload
  // uses it as its Bearer on HTTP RPC and mints one-shot wsTokens from it
  // before each WS upgrade.
  const connection = {
    httpUrl: `http://127.0.0.1:${runtime.mcpPort}`,
    wsUrl: `ws://127.0.0.1:${runtime.mcpPort}/events`,
    token: localSession.sessionToken,
  }

  const pickPairingHost = (): string => {
    // Prefer hostname so Tailscale magic DNS / mDNS / DHCP names work.
    // Fall back to first non-loopback IPv4. Loopback is returned only when
    // the server is bound to 127.0.0.1 (in which case remote pairing isn't
    // expected to work anyway; the URL is still useful for local dev).
    if (listenHost === '127.0.0.1' || listenHost === 'localhost') return '127.0.0.1'
    if (hostname && hostname !== 'localhost') return hostname
    const ips = listIpv4Hosts()
    return ips[0] ?? listenHost
  }

  const local: LocalServerHandle = {
    listenHost,
    port: runtime.mcpPort,
    serverId,
    hostname,
    listNetworkHosts: () => listIpv4Hosts(),
    issuePairingUrl: () => {
      const p = authStore.createPairingToken()
      const host = pickPairingHost()
      return {
        token: p.token,
        url: `http://${host}:${runtime.mcpPort}/pair#token=${p.token}`,
        expiresAt: p.expiresAt,
      }
    },
    listIncomingSessions: () => authStore.listSessions(),
    revokeIncomingSession: (sessionId) => authStore.revokeSession(sessionId),
  }

  const handle: ShellServerHandle = {
    mode: 'embedded',
    client: runtime.client as unknown as AppClient,
    connection,
    destroyAllPtys: () => runtime.ptyService.destroyAll(),
    connectAndRecover: () => runtime.connectAndRecover(),
    stop: async () => {
      await gateway.close()
      await runtime.stop()
    },
    getRunningPodCount: async () => {
      return runtime.db.select().from(pods).where(eq(pods.status, 'running')).all().length
    },
    getCloseToTray: async () => {
      const row = runtime.db.select().from(settings).where(eq(settings.key, 'app.closeToTray')).get()
      return row?.value === 'true'
    },
    getUnresolvedCounts: async () => {
      const counts = await runtime.runtime.runPromise(runtime.notificationService.unresolvedCounts())
      return { totalBlocking: counts.totalBlocking }
    },
  }
  return { handle, runtime, local, authStore }
}
