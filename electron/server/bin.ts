// -----------------------------------------------------------------------------
// Standalone Wanda server entrypoint.
//
// Runs the same `createServerRuntime()` factory the Electron shell uses, but
// with a WebSocket-backed broadcast instead of Electron IPC. This is the
// proof that the server runtime is Electron-free and can host the same API
// to a browser (or CLI, or remote Electron shell) over the network.
//
// Run directly:
//   bun electron/server/bin.ts
//   bun electron/server/bin.ts --host 127.0.0.1 --port 9191
//
// Environment:
//   WANDA_HOST             bind host (default: 127.0.0.1)
//   WANDA_PORT             bind port (default: 9191)
//   WANDA_DATA_DIR         data directory (default: APP_DOT_DIR)
//   WANDA_USER_DATA_DIR    snapshot/db location (default: WANDA_DATA_DIR)
//   WANDA_APP_ROOT         repo root for migrations + mcp paths (default: cwd)
//   WANDA_APP_VERSION      version reported to codex app-server (default: 0.0.0)
//
// Graceful shutdown: SIGINT / SIGTERM → stop runtime → exit 0.
// -----------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { ServerCapabilities } from '../../shared/contracts/capabilities'
import { APP_DOT_DIR, DB_FILENAME } from '../app-config'
import { configureSecretStore, createAesSecretStore, loadOrCreateSecretKey } from '../infra/secret-store'
import { log } from '../packages/logger'
import { AppRuntime, configureAgentRuntime, configureDatabase, DatabaseService } from '../services'
import { createAuthHttpHandler, createInMemoryAuthStore } from './auth'
import { ensureNonLoopbackAllowed } from './bind-guard'
import { getOrCreateServerIdentity } from './identity'
import { createServerRuntime } from './runtime'
import { WsGateway } from './ws-gateway'

interface CliArgs {
  host: string
  port: number
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  let host = process.env.WANDA_HOST ?? '127.0.0.1'
  let port = parseInt(process.env.WANDA_PORT ?? '9191', 10)
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--host' && next !== undefined) {
      host = next
      i++
    } else if (arg === '--port' && next !== undefined) {
      port = parseInt(next, 10)
      i++
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: bun electron/server/bin.ts [--host HOST] [--port PORT]

Environment variables override defaults; CLI flags override env vars.

  --host HOST       bind host (default: 127.0.0.1)
  --port PORT       bind port (default: 9191)

Env: WANDA_HOST WANDA_PORT WANDA_DATA_DIR WANDA_USER_DATA_DIR
     WANDA_APP_ROOT WANDA_MCP_SERVER_PATH WANDA_APP_VERSION`)
      process.exit(0)
    }
  }
  return { host, port }
}

async function main(): Promise<void> {
  const { host, port } = parseArgs(process.argv.slice(2))

  if (host !== '127.0.0.1' && host !== 'localhost') {
    ensureNonLoopbackAllowed(host)
  }

  const dataDir = process.env.WANDA_DATA_DIR ?? APP_DOT_DIR
  const userDataDir = process.env.WANDA_USER_DATA_DIR ?? dataDir
  const appRoot = process.env.WANDA_APP_ROOT ?? process.cwd()
  const appVersion = process.env.WANDA_APP_VERSION ?? '0.0.0'
  const mcpPortFile = process.env.WANDA_PORT_FILE ?? join(dataDir, 'mcp-port')
  const dbPath = process.env.WANDA_DB_PATH ?? join(userDataDir, DB_FILENAME)
  const migrationsFolder = process.env.WANDA_MIGRATIONS_FOLDER ?? join(appRoot, 'electron/db/migrations')

  log.main.info('Wanda standalone server starting')
  log.main.info(`  bind:           ${host}:${port}`)
  log.main.info(`  dataDir:        ${dataDir}`)
  log.main.info(`  userDataDir:    ${userDataDir}`)
  log.main.info(`  appRoot:        ${appRoot}`)
  log.main.info(`  dbPath:         ${dbPath}`)
  log.main.info(`  migrations:     ${migrationsFolder}`)

  // Configure the (otherwise Electron-free) server hooks.
  configureDatabase({ dbPath, migrationsFolder })
  configureAgentRuntime({
    appRoot,
    mcpServerPath: process.env.WANDA_MCP_SERVER_PATH,
    appVersion,
    openExternal: (url: string) => {
      log.main.info(`openExternal (no-op in standalone mode): ${url}`)
    },
  })
  // Secret store: AES-256-GCM with a key file under dataDir. The key
  // stays on the host filesystem with 0600 perms. A backup of the
  // sqlite DB is useless without the sibling secret.key.
  const secretKey = loadOrCreateSecretKey(join(dataDir, 'secret.key'))
  configureSecretStore(createAesSecretStore(secretKey))

  // Pairing + session + ws-token store. Session tokens are persisted to
  // SQLite (the main server DB) so paired clients survive restarts. Short-
  // lived pairing/ws tokens remain in-memory — they're meant to be ephemeral.
  //
  // Resolve DB up-front so the AuthStore can hydrate persisted sessions
  // before any RPC can hit the server.
  const db = await AppRuntime.runPromise(DatabaseService)
  // Persistent server identity — stable across restarts so paired clients
  // don't accumulate a new entry per boot.
  const identity = getOrCreateServerIdentity(db)
  const serverId = identity.id
  const authStore = createInMemoryAuthStore(serverId, { db })

  // Mint a session for whatever process spawned us (typically the Electron
  // shell). The handshake line below emits the sessionToken, which the shell
  // uses exactly like a paired client would: Bearer on HTTP RPC, swapped
  // for wsTokens before each WS upgrade. The former static WANDA_TOKEN flow
  // has been removed.
  const shellSession = authStore.createLocalSession({
    deviceName: `${hostname()}-shell-subprocess`,
    os: process.platform,
    appVersion,
  })
  const sessionToken = shellSession.sessionToken
  log.main.info(`  session token:  ${sessionToken.slice(0, 8)}… (${sessionToken.length} chars)`)

  // Build the capability descriptor. SSH fields come from env vars since
  // auto-detection is both finicky and easy to get wrong; operators can
  // point clients at their real reachable address.
  const sshHost = process.env.WANDA_SSH_HOST ?? null
  const capabilities: ServerCapabilities = {
    serverId,
    hostname: hostname(),
    appVersion,
    ssh:
      sshHost != null
        ? {
            host: sshHost,
            user: process.env.WANDA_SSH_USER ?? process.env.USER ?? 'unknown',
            port: process.env.WANDA_SSH_PORT ? Number(process.env.WANDA_SSH_PORT) : undefined,
            workspacePath: process.env.WANDA_WORKSPACE_PATH ?? userDataDir,
          }
        : null,
    features: {
      docker: true,
      agents: true,
      workspaceRoot: process.env.WANDA_WORKSPACE_PATH ?? userDataDir,
    },
  }

  const authHandler = createAuthHttpHandler({ store: authStore, capabilities })

  // Configure attachment blob storage before the AppLayer resolves + build
  // the composed HTTP handler that serves both /api/auth/* and
  // /attachments/:id. Mirrors the wiring in shell/server-handle.ts.
  const { configureAttachmentService, makeAttachmentHttpHandler } = await import('../domains/agent-attachment')
  const { join: joinPath } = await import('node:path')
  const attachmentBaseDir = joinPath(userDataDir, 'agent-attachments')
  configureAttachmentService({ baseDir: attachmentBaseDir })
  const attachmentsHandler = makeAttachmentHttpHandler({ authStore, appRuntime: AppRuntime })
  const combinedHttpHandler = async (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => {
    if (await authHandler(req, res)) return true
    if (await attachmentsHandler(req, res)) return true
    return false
  }

  // Create the WebSocket gateway. Host allow-list is set after the
  // runtime binds so it reflects the actual (post-ephemeral-resolution) port.
  // Only accepts one-shot wsTokens minted by the AuthStore — every client
  // (including the local shell) goes through the session → wsToken flow.
  let runtimeMessageHandler: ((channel: string, args: unknown[]) => void) | undefined
  const wsGateway = new WsGateway({
    authStore,
    serverId,
    epoch: identity.epoch,
    onMessage: (channel, args) => runtimeMessageHandler?.(channel, args),
  })

  // Bring up the runtime with a WebSocket-backed broadcast.
  const runtime = await createServerRuntime({
    snapshotStoreDir: userDataDir,
    mcpPortFile,
    mcpAuthToken: sessionToken,
    host,
    port,
    epoch: identity.epoch,
    broadcast: wsGateway.broadcast,
    extraHttpHandler: combinedHttpHandler,
    authenticateRpc: (req) => {
      const auth = req.headers.authorization
      if (!auth) return false
      const parts = auth.split(' ')
      if (parts.length !== 2 || parts[0] !== 'Bearer') return false
      const provided = parts[1] ?? ''
      return authStore.validateSession(provided) !== null
    },
    onNotificationsChanged: () => {
      wsGateway.broadcast('notifications:changed')
    },
  })

  // Wire terminal WS input handler
  runtimeMessageHandler = runtime.handleWsMessage

  // Wire the agent runtime. Mock always ships (for tests + no-key boot);
  // Codex direct resolves its API key lazily so rotation via the Settings UI
  // works without restart. Same wiring lives in the Electron shell's
  // server-handle.ts — keep in sync.
  const { configureAgentRuntimeDeps } = await import('../domains/agent-runtime')
  const { ensureDirectCodexHome } = await import('../domains/agent-runtime/codex-home')
  const { hasWandaMcpServer } = await import('../packages/agent-mcp')
  const { makeDrizzleSessionStore, makeDrizzlePendingPermissionsStore } = await import('../domains/chat-session')
  const { makeRuntimePermissionPolicyStore } = await import('../domains/permission-policy')
  const { mockProvider } = await import('@wanda/agent-runtime')
  const { codexDirectProvider } = await import('@wanda/agent-providers/codex')
  const { providerSecrets } = await import('../db/schema')
  const { decryptSecret } = await import('../infra/secret-store')
  const { eq } = await import('drizzle-orm')
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
    subscriptions: wsGateway.subscriptionManager,
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

  // Boot drain: settle any permission prompts that were outstanding when
  // the previous process exited. See server-handle.ts for the rationale.
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

  // Attach WebSocket upgrade handler to the HTTP server the factory created.
  wsGateway.attachTo(runtime.httpServer, runtime.eventLog)

  // Now that we know the real port, install the Host allow-list. This is
  // defense-in-depth against DNS rebinding for loopback deployments; when
  // binding to a non-loopback address, operators should configure TLS
  // and/or a reverse proxy that enforces Host validation itself.
  if (host === '127.0.0.1' || host === 'localhost') {
    wsGateway.setAllowedHosts([`127.0.0.1:${runtime.mcpPort}`, `localhost:${runtime.mcpPort}`])
  }

  // If spawned by the Electron shell (subprocess mode), emit a JSON handshake
  // on stdout so the shell can discover port + session token without env/file
  // tricks. The token advertised here is the shell's *session* token — the
  // shell uses it for HTTP RPC and swaps it for one-shot wsTokens via
  // /api/auth/ws-token before each WS upgrade.
  if (process.env.WANDA_HANDSHAKE_STDOUT === '1') {
    process.stdout.write(
      `${JSON.stringify({
        type: 'wanda-server-ready',
        host,
        port: runtime.mcpPort,
        token: sessionToken,
      })}\n`,
    )
  }

  log.main.info(`Wanda server ready at http://${host}:${runtime.mcpPort}`)
  log.main.info(`  HTTP RPC:   POST http://${host}:${runtime.mcpPort}/rpc/*`)
  log.main.info(`  WS events:  ws://${host}:${runtime.mcpPort}/events`)

  // Issue an initial pairing token so operators can pair a client without
  // needing to run a separate CLI. Token is short-lived + single-use;
  // regenerate with `wanda-server pair` (future command).
  const pairing = authStore.createPairingToken()
  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    writeFileSync(join(dataDir, 'pairing.token'), pairing.token, { mode: 0o600 })
  } catch (err) {
    log.main.warn('failed to write pairing.token file:', err)
  }
  const pairHost = sshHost ?? host
  const pairUrl = `http://${pairHost}:${runtime.mcpPort}/pair#token=${pairing.token}`
  log.main.info('')
  log.main.info('  Pair a client with:')
  log.main.info(`    ${pairUrl}`)
  log.main.info(`  (Pairing token expires in 15 minutes, server id: ${serverId})`)

  // Kick off remote target reconnect + container recovery.
  void runtime.connectAndRecover()

  // Graceful shutdown on SIGTERM/SIGINT.
  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log.main.info(`received ${signal}, shutting down`)
    try {
      await wsGateway.close()
      await runtime.stop()
    } catch (err) {
      log.main.error('shutdown error:', err)
    }
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  // Also handle uncaught exceptions so the server exits cleanly instead of
  // dangling with partial state.
  process.on('uncaughtException', (err) => {
    log.main.error('uncaughtException:', err)
    void shutdown('uncaughtException')
  })
  process.on('unhandledRejection', (reason) => {
    log.main.error('unhandledRejection:', reason)
    void shutdown('unhandledRejection')
  })
}

main().catch((err) => {
  log.main.error('fatal:', err)
  process.exit(1)
})
