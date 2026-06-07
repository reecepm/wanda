// -----------------------------------------------------------------------------
// Server runtime factory.
//
// Brings up every Effect service, controller, watcher, HTTP server, and
// background worker — no Electron imports, so it can also run under a
// standalone node entry (see `electron/server/bin.ts`). Takes a `broadcast`
// callback + filesystem paths from the shell and returns a handle that
// exposes lifecycle hooks (stop, connectAndRecover, handleWsMessage, ...).
// -----------------------------------------------------------------------------

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server as HttpServer } from 'node:http'
import { join } from 'node:path'
import { createRouterClient, type RouterClient } from '@orpc/server'
import { RPCHandler } from '@orpc/server/node'
import { type EventLog, openEventLog } from '@wanda/event-log'
import type { EventChannel, ResourceKind } from '@wanda/wire'
import { eq } from 'drizzle-orm'
import type { GitStatusEvent } from '../../shared/contracts/git-status'
import type { AppDatabase } from '../db/connection'
import { pods, settings } from '../db/schema'
import type {
  NotificationControllerShape,
  NotificationEmitInput,
} from '../domains/notification/controller/notifications'
import type { PodControllerShape } from '../domains/pod/controller/pod'
import { configureBroadcaster } from '../infra/broadcaster'
import type { GcServiceShape } from '../infra/gc'
import { ApprovalWatcher } from '../packages/agent-hooks'
import { resolveWandaMcpEnabledForApp } from '../packages/agent-mcp'
import { log } from '../packages/logger'
import { SnapshotStore } from '../packages/pty/snapshot-store' // Still used by DockerService
import { UrlWatcher } from '../packages/url-watcher'
import { resolveShellExec as resolveShellExecHelper } from '../router/helpers'
import { type AgentStateCache, createAppRouter } from '../router/index'
import {
  AgentController,
  AgentStatusService,
  type AppManagedRuntime,
  AppRuntime,
  DatabaseService,
  DockerService,
  FileService,
  GcService,
  NotificationController,
  PodController,
  PtyService,
  WorkenvExec,
  WorkenvReconciler,
  WorkenvTemplates,
} from '../services'
import type { DockerServiceShape } from '../services/docker.service'
import type { FileServiceShape } from '../services/file.service'
import { GitStatusBroadcaster } from '../services/git-status-broadcaster'
import type { GitWatcher } from '../services/git-watcher'
import type { PtyServiceShape } from '../services/pty.service'
import { LocalTarget } from '../targets/local-target'
import { TargetManager } from '../targets/target-manager'
import { makeAgentStatusWebhook } from './agent-status-webhook'
import { createHookTokenGuard } from './hook-token'
import { makeHttpRequestHandler } from './http-router'
import { makeMutationInterceptors } from './mutation-registry'

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface ServerRuntimeOpts {
  /** Directory where PTY scrollback snapshots + raw logs are persisted. */
  readonly snapshotStoreDir: string
  /** File path where the HTTP port is written for MCP / hook clients. */
  readonly mcpPortFile: string
  /**
   * Session token written to a sibling `mcp-token` file (mode 0600) so spawned
   * MCP servers can authenticate their RPC calls. Omitted → no token file is
   * written and MCP data-plane calls will be rejected with 401.
   */
  readonly mcpAuthToken?: string
  /**
   * Server boot epoch (from @wanda/session.SessionStore / identity.ts).
   * Bumped once per process startup. The EventLog tags every row with it so
   * clients that reconnect across a restart can detect the gap.
   */
  readonly epoch: number
  /** Push an event to any connected UI clients (Electron renderer, tray window, or WebSocket subscribers). */
  readonly broadcast: (channel: string, ...args: unknown[]) => void
  /**
   * Called after any change that affects the unresolved notification counts.
   * The shell uses this to refresh its dock badge / tray badge. The handle's
   * own `emitNotification` already invokes it; it's also called from the
   * HTTP `/agent-status` webhook path.
   */
  readonly onNotificationsChanged: () => void
  /** HTTP bind host. Defaults to 127.0.0.1 (loopback-only). */
  readonly host?: string
  /** HTTP bind port. Defaults to 0 (ephemeral). */
  readonly port?: number
  /**
   * Optional pre-handler consulted BEFORE the oRPC router. Return `true` if
   * the request was fully handled (the runtime will not fall through). Used
   * to mount the pairing/auth/capabilities endpoints without the runtime
   * having to know about the AuthStore.
   */
  readonly extraHttpHandler?: (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => Promise<boolean>
  /**
   * Optional gate applied to every request that reaches the oRPC handler
   * (i.e. after CORS / extraHttpHandler / agent-status). Return `true` to
   * allow, `false` to reject with 401. When omitted, the RPC handler is
   * open — safe only for loopback embedded mode.
   *
   * bin.ts wires this to accept a session token validated by AuthStore,
   * so paired clients can call RPCs directly with their session token.
   */
  readonly authenticateRpc?: (req: import('node:http').IncomingMessage) => boolean | Promise<boolean>
}

export interface ServerRuntimeHandle {
  readonly runtime: AppManagedRuntime
  readonly db: AppDatabase
  readonly client: RouterClient<ReturnType<typeof createAppRouter>>
  readonly httpServer: HttpServer
  readonly mcpPort: number
  readonly targetManager: TargetManager
  readonly ptyService: PtyServiceShape
  readonly podService: PodControllerShape
  readonly notificationService: NotificationControllerShape
  readonly dockerService: DockerServiceShape
  readonly fileService: FileServiceShape
  readonly gitWatcher: GitWatcher
  readonly gitStatusBroadcaster: GitStatusBroadcaster
  readonly agentState: AgentStateCache
  /**
   * Durable event log. Records resource mutations under `event:*` channels
   * so the Gateway can replay them across reconnects.
   */
  readonly eventLog: EventLog
  /** Fire-and-forget notification emission with automatic shell refresh. */
  readonly emitNotification: (input: NotificationEmitInput) => void
  /** Kick off remote target connection + container recovery (post-ready). */
  readonly connectAndRecover: () => Promise<void>
  /** Stop everything and dispose the Effect runtime. */
  readonly stop: () => Promise<void>
  /**
   * Handle an incoming WS message from a client. Route terminal
   * write/resize/ack commands directly to the target manager, bypassing
   * HTTP POST for in-order delivery.
   */
  readonly handleWsMessage: (channel: string, args: unknown[]) => void
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

export async function createServerRuntime(opts: ServerRuntimeOpts): Promise<ServerRuntimeHandle> {
  const { broadcast: rawBroadcast, onNotificationsChanged } = opts

  // Forward ref so the broadcast wrapper below can call into the
  // git-status broadcaster (which doesn't exist yet at this point).
  let gitStatusBroadcasterRef: GitStatusBroadcaster | null = null

  // Wrap broadcast so server-side services can react to certain events
  // without going through a separate event bus. The events still get
  // forwarded to clients as normal.
  const broadcast: typeof rawBroadcast = (channel, ...args) => {
    if (channel === 'pod:gitContextChanged' && typeof args[0] === 'string') {
      void gitStatusBroadcasterRef
        ?.refreshContext(args[0])
        .catch((err) => log.main.warn('git-status refreshContext failed:', err))
    }
    rawBroadcast(channel, ...args)
  }

  // Durable event log. Lives in its own SQLite file under the snapshot dir
  // so its WAL doesn't share a lock with the main app DB.
  const eventLogDir = opts.snapshotStoreDir
  if (!existsSync(eventLogDir)) mkdirSync(eventLogDir, { recursive: true })
  const eventLog = openEventLog(join(eventLogDir, 'event-log.db'), { epoch: opts.epoch })

  function publishEvent(channel: EventChannel, resourceKind: ResourceKind, resourceId: string, payload: unknown): void {
    try {
      const record = eventLog.publish(channel, resourceKind, resourceId, payload)
      // Dual-publish to the legacy broadcast firehose so consumers that
      // haven't migrated to per-resource subscriptions still see events.
      broadcast(channel, {
        resourceKind,
        resourceId,
        payload,
        seq: record.seq,
        epoch: record.epoch,
      })
    } catch (err) {
      log.main.warn(`eventLog.publish failed for ${channel} (${resourceKind}/${resourceId}):`, err)
    }
  }

  // Configure the broadcast emitter used by domain services (pod status,
  // build progress, notification changes, etc.) BEFORE any Effect layer
  // resolves Broadcaster. Without this the default no-op would silently
  // drop every domain event.
  configureBroadcaster(broadcast)

  // --- Step 1: DB, seeds, and crash marker -----------------------------------

  const workenvTemplatesService = await AppRuntime.runPromise(WorkenvTemplates)
  await AppRuntime.runPromise(workenvTemplatesService.seedBuiltIns())
  // Boot-time reconciliation: any workenv whose adapter no longer knows
  // about its handle gets flagged 'stranded' so the UI can offer recovery
  // instead of pretending the VM is still there.
  try {
    const reconciler = await AppRuntime.runPromise(WorkenvReconciler)
    const { stranded, checked } = await AppRuntime.runPromise(reconciler.reconcile())
    if (stranded > 0) {
      log.pod.info(`workenv reconciler: ${stranded}/${checked} stranded on boot`)
    }
  } catch (err) {
    log.pod.warn('workenv reconciler failed on boot', err)
  }
  const db = await AppRuntime.runPromise(DatabaseService)

  // Crash detection: mark app state as dirty immediately, clean on graceful quit.
  db.insert(settings)
    .values({ key: 'app.state', value: 'dirty', updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: 'dirty', updatedAt: new Date() } })
    .run()

  // --- Step 2: background workers ------------------------------------------

  const gc: GcServiceShape = await AppRuntime.runPromise(GcService)
  gc.start()

  // --- Step 3: hot-path services + target manager --------------------------

  const ptyService = await AppRuntime.runPromise(PtyService)
  const dockerService = await AppRuntime.runPromise(DockerService)

  // Configure the TerminalEngine with persistence (creates the PtyHost subprocess)
  ptyService.configure(opts.snapshotStoreDir)
  await ptyService.ready

  // Docker still uses the old SnapshotStore for its own exec streams
  const snapshotStore = new SnapshotStore(opts.snapshotStoreDir)
  dockerService.setSnapshotStore(snapshotStore)

  const localTarget = new LocalTarget('local', 'Local', ptyService, dockerService)
  const targetManager = new TargetManager(localTarget)

  // Auto-subscribe all local streams so data flows to the broadcast layer.
  // In the future, the WS gateway can selectively subscribe/unsubscribe
  // based on which terminal the client is viewing.
  targetManager.onStreamRegistered((streamId) => {
    ptyService.subscribe(streamId)
  })
  targetManager.onStreamUnregistered((streamId) => {
    ptyService.unsubscribe(streamId)
  })

  const podService = await AppRuntime.runPromise(PodController)
  podService.setTargetManager(targetManager)
  const workenvExec = await AppRuntime.runPromise(WorkenvExec)

  const notificationService = await AppRuntime.runPromise(NotificationController)

  // Fire-and-forget notification emission with error logging.
  const emitNotification = (input: NotificationEmitInput) => {
    void AppRuntime.runPromise(notificationService.emit(input))
      .then(() => onNotificationsChanged())
      .catch((err) => log.main.warn('notification emission failed:', err))
  }

  // --- Step 4: watchers (git, url, approval, file) -------------------------

  // Broadcaster and watcher reference each other: the watcher's callback
  // pushes into the broadcaster, and the broadcaster registers repo paths
  // with the watcher. The forward ref `gitStatusBroadcasterRef` is declared
  // at the top of this function so the broadcast wrapper can reach it too.

  const { GitWatcher } = await import('../services/git-watcher')
  const gitWatcher = new GitWatcher((repoPath) => {
    // Two fan-outs per change: the subscription broadcaster drives live
    // status UI, the coarse orpc:invalidate refetches any useQuery that
    // reads from `git.getStatus`.
    gitStatusBroadcasterRef?.onRepoChanged(repoPath)
    broadcast('orpc:invalidate', 'git', 'getStatus')
  })

  const gitStatusBroadcaster = new GitStatusBroadcaster(
    AppRuntime,
    (pod) => resolveShellExecHelper(pod, targetManager),
    (event: GitStatusEvent) => broadcast('git:status', event),
    gitWatcher,
  )
  gitStatusBroadcasterRef = gitStatusBroadcaster

  const fileService = await AppRuntime.runPromise(FileService)
  fileService.setChangeCallback((watchId, mtimeMs) => {
    broadcast('file:changed', watchId, mtimeMs)
  })

  const urlWatcher = new UrlWatcher((streamId, url) => {
    const podId = podService.streamToPodId(streamId)
    broadcast('terminal:urlDetected', streamId, url, podId ?? null)
  })

  const approvalWatcher = new ApprovalWatcher((event) => {
    const terminalId = podService.streamToTerminalId(event.streamId)
    if (!terminalId) return
    const podId = podService.terminalToPodId(terminalId)
    const detail = event.command ? `${event.toolName}: ${event.command}` : event.toolName
    emitNotification({
      type: 'agent:permission-request',
      priority: 'blocking',
      podId: podId ?? undefined,
      podTerminalId: terminalId,
      title: `Agent permission: ${event.toolName}`,
      body: event.command ?? undefined,
      payload: { source: 'pty-watcher', toolName: event.toolName, command: event.command },
    })
    log.main.debug(`Approval detected for terminal ${terminalId}: ${detail}`)
  })

  // --- Step 5: target stream forwarding -----------------------------------

  const streamDataCounts = new Map<string, number>()

  targetManager.onStreamData((streamId, data) => {
    const count = (streamDataCounts.get(streamId) ?? 0) + 1
    streamDataCounts.set(streamId, count)
    if (count <= 3) {
      log.main.debug(`forwarding terminal:data for ${streamId} (#${count})`)
    }
    broadcast('terminal:data', streamId, data)

    // Ack flow control — the main process has consumed this data by
    // broadcasting it. Without this, the PtyHost's flow controller
    // pauses the PTY at 100KB unacked and the terminal freezes.
    ptyService.ack(streamId, data.length)

    // Scan agent terminal output for approval prompts.
    approvalWatcher.feed(streamId, data)

    // Scan command output for dev-server URLs (not terminals/agents).
    if (podService.isCommandStream(streamId)) {
      urlWatcher.feed(streamId, data)
    }
  })

  targetManager.onStreamExit((streamId, code) => {
    urlWatcher.reset(streamId)
    log.main.info(`forwarding terminal:exit for ${streamId}, code=${code}`)
    broadcast('terminal:exit', streamId, code)

    // Emit notification for non-zero exit codes, skipping signal-based exits.
    if (code !== 0 && code <= 128) {
      const podId = podService.streamToPodId(streamId)
      emitNotification({
        type: 'terminal:exit',
        priority: 'urgent',
        podId: podId ?? undefined,
        title: `Terminal exited with code ${code}`,
        payload: { streamId, code },
      })
    }
  })

  // --- Step 7: router + HTTP server + agent-status webhook -----------------

  const agentState: AgentStateCache = { models: null, authUrl: null, ready: false }
  const appRouter = createAppRouter(AppRuntime, {
    targetManager,
    agentState,
    gitWatcher,
    gitStatusBroadcaster,
    workenvExec,
  })
  const client = createRouterClient(appRouter)

  const rpcHandler = new RPCHandler(appRouter, {
    clientInterceptors: makeMutationInterceptors({ broadcast, publishEvent }),
  })

  const agentStatusService = await AppRuntime.runPromise(AgentStatusService)

  // Per-server hook token guard. The `/agent-status` webhook self-authenticates
  // with this token (injected into every generated hook) because it runs before
  // the RPC auth gate; without it any local process could forge approval of a
  // pending permission prompt.
  const hookToken = createHookTokenGuard()

  const handleAgentStatus = makeAgentStatusWebhook({
    hookToken,
    agentStatusService,
    emitNotification,
    resolvePendingPermissionsForTerminal: (terminalId) =>
      AppRuntime.runPromise(notificationService.resolvePendingPermissionsForTerminal(terminalId, 'accepted')),
    terminalToPodId: (terminalId) => podService.terminalToPodId(terminalId),
    onPermissionsResolved: () => {
      onNotificationsChanged()
      broadcast('agent:permission-resolved')
    },
    onRepoChanged: (cwd) => gitStatusBroadcaster.onRepoChanged(cwd),
  })

  const httpServer = createServer(
    makeHttpRequestHandler({
      rpcHandler,
      handleAgentStatus,
      extraHttpHandler: opts.extraHttpHandler,
      authenticateRpc: opts.authenticateRpc,
    }),
  )

  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? 0
  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      const addr = httpServer.address()
      if (!addr || typeof addr === 'string') throw new Error('Expected AddressInfo from httpServer.address()')
      const mcpPortDir = opts.mcpPortFile.substring(0, opts.mcpPortFile.lastIndexOf('/'))
      if (!existsSync(mcpPortDir)) mkdirSync(mcpPortDir, { recursive: true })
      writeFileSync(opts.mcpPortFile, String(addr.port), { mode: 0o600 })
      if (opts.mcpAuthToken) {
        try {
          writeFileSync(`${mcpPortDir}/mcp-token`, opts.mcpAuthToken, { mode: 0o600 })
        } catch (err) {
          log.main.warn('failed to write MCP token file; MCP RPC calls will be unauthorized:', err)
        }
      }
      try {
        writeFileSync(`${mcpPortDir}/hook-token`, hookToken.value, { mode: 0o600 })
      } catch (err) {
        log.main.warn('failed to write hook token file; agent-status hooks will be rejected:', err)
      }
      log.main.info(`oRPC HTTP server listening on ${host}:${addr.port}`)
      resolve()
    })
  })

  const httpAddr = httpServer.address()
  if (!httpAddr || typeof httpAddr === 'string') throw new Error('Expected AddressInfo')
  const mcpPort = httpAddr.port
  podService.setHttpPort(mcpPort)
  podService.setHookToken(hookToken.value)

  // --- Step 8: agent controller event wiring + background init ------------

  const agentService = await AppRuntime.runPromise(AgentController)

  agentService.onMessage((sessionId, msg) => {
    broadcast('agent:message', sessionId, msg)

    // Auto-resolve stale permission notifications when the agent proceeds.
    const method = msg.method
    const item = msg.params.item
    const itemType =
      item != null && typeof item === 'object' && 'type' in item && typeof item.type === 'string'
        ? item.type
        : undefined
    if (
      (method === 'item/started' && (itemType === 'commandExecution' || itemType === 'fileChange')) ||
      method === 'turn/completed'
    ) {
      void AppRuntime.runPromise(notificationService.resolveAllPendingPermissions())
        .then((count) => {
          if (count > 0) {
            onNotificationsChanged()
            broadcast('agent:permission-resolved')
          }
        })
        .catch((err) => log.main.warn('permission resolution failed:', err))
    }
  })

  agentService.onPermissionRequest((req) => {
    broadcast('agent:permission-request', req)

    // Look up the pod by cwd so the notification is at least pod-scoped.
    const pod = req.cwd ? db.select().from(pods).where(eq(pods.cwd, req.cwd)).get() : undefined
    emitNotification({
      type: 'agent:permission-request',
      priority: 'blocking',
      podId: pod?.id ?? undefined,
      title: `Agent permission: ${req.type}`,
      body: req.command ?? undefined,
      payload: { requestId: req.requestId, type: req.type, command: req.command },
    })
  })

  agentService.onAuthRequired((authUrl) => {
    agentState.authUrl = authUrl
    broadcast('agent:auth-required', authUrl)
  })

  agentService.onModelsLoaded((models) => {
    agentState.models = models
    log.main.debug(`forwarding ${models.length} models to renderer`)
    broadcast('agent:models-loaded', models)
  })

  agentService.onReady(() => {
    agentState.ready = true
    log.main.debug('agent ready')
    broadcast('agent:ready')
  })

  // Forward agent status changes to renderer.
  agentStatusService.onChange((terminalId, entry) => {
    broadcast('agent:status', terminalId, {
      status: entry.status,
      agentType: entry.agentType,
      sessionId: entry.sessionId,
      errorDetail: entry.errorDetail,
      exitCode: entry.exitCode,
      exitOutput: entry.exitOutput,
    })
  })

  // Configure the legacy topbar agent bridge. The Codex app-server itself is
  // started lazily by AgentController on first legacy session use.
  const includeTopbarWandaMcp = resolveWandaMcpEnabledForApp(db)
  AppRuntime.runPromise(agentService.init(mcpPort, { includeWandaMcp: includeTopbarWandaMcp })).catch((err) =>
    log.main.error('agent init failed:', err),
  )

  // --- Step 9: post-ready container recovery (deferred) --------------------

  const connectAndRecover = async (): Promise<void> => {
    try {
      await targetManager.connectAll()
    } catch (err) {
      log.main.warn('target connectAll failed:', err)
    }
    try {
      const appState = db.select().from(settings).where(eq(settings.key, 'app.state')).get()
      const wasDirty = appState?.value === 'dirty'
      const { recovered, failed } = await AppRuntime.runPromise(podService.recoverContainers())
      if (recovered > 0 || failed > 0) {
        broadcast('pod:recovered', { recovered, failed, wasDirty })
      }
    } catch (err) {
      log.main.error('container recovery failed:', err)
    }
  }

  // --- Shutdown -------------------------------------------------------------

  const stop = async (): Promise<void> => {
    // Mark clean exit before anything else touches the DB.
    try {
      db.insert(settings)
        .values({ key: 'app.state', value: 'clean', updatedAt: new Date() })
        .onConflictDoUpdate({ target: settings.key, set: { value: 'clean', updatedAt: new Date() } })
        .run()
    } catch (err) {
      log.main.warn('failed to mark clean exit:', err)
    }

    // Clean up AgentController (.mcp.json entry).
    try {
      await AppRuntime.runPromise(agentService.cleanup())
    } catch (err) {
      log.main.warn('agent cleanup failed:', err)
    }

    // Stop background workers.
    gc.stop()

    // Pod shutdown (stops containers, destroys PTYs via PodController).
    try {
      await podService.shutdown()
    } catch (err) {
      log.main.warn('pod shutdown failed:', err)
    }
    ptyService.destroyAll()
    dockerService.flushAllScrollback()

    // Disconnect remote targets.
    try {
      await targetManager.disconnectAll()
    } catch (err) {
      log.main.warn('target disconnect failed:', err)
    }

    // Close HTTP server and remove port + token files.
    httpServer.close()
    try {
      unlinkSync(opts.mcpPortFile)
    } catch (err) {
      log.main.warn('failed to remove MCP port file:', err)
    }
    const mcpPortDir = opts.mcpPortFile.substring(0, opts.mcpPortFile.lastIndexOf('/'))
    if (opts.mcpAuthToken) {
      try {
        unlinkSync(`${mcpPortDir}/mcp-token`)
      } catch {
        // token file already gone — nothing to clean up
      }
    }
    try {
      unlinkSync(`${mcpPortDir}/hook-token`)
    } catch {
      // token file already gone — nothing to clean up
    }

    try {
      eventLog.close()
    } catch (err) {
      log.main.warn('eventLog close failed:', err)
    }

    try {
      await AppRuntime.dispose()
    } catch (err) {
      log.main.warn('runtime dispose failed:', err)
    }
  }

  return {
    runtime: AppRuntime,
    db,
    client,
    httpServer,
    mcpPort,
    targetManager,
    ptyService,
    podService,
    notificationService,
    dockerService,
    fileService,
    gitWatcher,
    gitStatusBroadcaster,
    agentState,
    eventLog,
    emitNotification,
    connectAndRecover,
    stop,
    handleWsMessage: (channel: string, args: unknown[]) => {
      switch (channel) {
        case 'terminal:write': {
          const [id, data] = args as [string, string]
          if (id && data != null) {
            if (targetManager.hasStream(id)) targetManager.writeStream(id, data)
            else workenvExec.write(id, data)
          }
          break
        }
        case 'terminal:resize': {
          const [id, cols, rows] = args as [string, number, number]
          if (id && typeof cols === 'number' && typeof rows === 'number') {
            if (targetManager.hasStream(id)) targetManager.resizeStream(id, cols, rows)
            else workenvExec.resize(id, cols, rows)
          }
          break
        }
        case 'terminal:ack': {
          const [id, bytes] = args as [string, number]
          if (id && typeof bytes === 'number') ptyService.ack(id, bytes)
          break
        }
      }
    },
  }
}
