import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { Context, Effect, Layer } from 'effect'
import { v4 as uuid } from 'uuid'
import { APP_DOT_DIR, MCP_SECTION } from '../../../app-config'
import { globalBinPath } from '../../../packages/agent-commands'
import { log } from '../../../packages/logger'

// ---------------------------------------------------------------------------
// Runtime configuration (injected by the shell)
// ---------------------------------------------------------------------------

/**
 * Shell-provided runtime config. Decouples the agent controller from Electron
 * so this module has no `electron` imports and can run in a pure Node server.
 * Must be supplied via `configureAgentRuntime` before `init(port)` is called.
 */
interface AgentRuntimeConfig {
  /** Absolute path to the app root (used to locate the bundled MCP server script). */
  readonly appRoot: string
  /** Absolute path to a compiled MCP server entrypoint, when packaged outside appRoot. */
  readonly mcpServerPath?: string
  /** App version string reported to the Codex app-server via `initialize`. */
  readonly appVersion: string
  /** Opens a URL in the user's default browser (typically `shell.openExternal`). */
  readonly openExternal: (url: string) => void
}

let runtimeConfig: AgentRuntimeConfig = {
  appRoot: process.cwd(),
  appVersion: '0.0.0',
  openExternal: (url: string) => {
    log.agent.warn(`openExternal called but runtime not configured; URL was: ${url}`)
  },
}

/**
 * Configure the agent runtime. Called by the shell (or standalone server
 * entry) before the agent controller's `init(port)` runs.
 */
export function configureAgentRuntime(config: AgentRuntimeConfig): void {
  runtimeConfig = config
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentSession {
  id: string
  threadId: string | null
  status: 'running' | 'idle' | 'stopped'
  cwd: string
}

interface ApprovalRequest {
  requestId: number
  type: 'commandExecution' | 'fileChange'
  command?: string
  cwd?: string
  reason?: string
  grantRoot?: string
}

/** A Codex App Server notification forwarded to the renderer */
interface CodexEvent {
  method: string
  params: Record<string, unknown>
}

interface CodexModel {
  id: string
  displayName: string
  isDefault?: boolean
}

interface AgentControllerShape {
  readonly init: (port: number, opts?: { includeWandaMcp?: boolean }) => Effect.Effect<void>
  readonly cleanup: () => Effect.Effect<void>
  readonly startSession: (opts: { cwd: string; developerInstructions?: string }) => Effect.Effect<AgentSession>
  readonly sendMessage: (id: string, message: string, model?: string) => Effect.Effect<void>
  readonly stopSession: (id: string) => Effect.Effect<void>
  readonly list: () => Effect.Effect<AgentSession[]>
  readonly onMessage: (callback: (id: string, msg: CodexEvent) => void) => () => void
  readonly onPermissionRequest: (callback: (req: ApprovalRequest) => void) => () => void
  readonly resolvePermission: (requestId: number, decision: 'accept' | 'acceptForSession' | 'decline') => void
  readonly onAuthRequired: (callback: (authUrl: string) => void) => () => void
  readonly onModelsLoaded: (callback: (models: CodexModel[]) => void) => () => void
  readonly onReady: (callback: () => void) => () => void
}

export class AgentController extends Context.Tag('AgentController')<AgentController, AgentControllerShape>() {}

// ---------------------------------------------------------------------------
// Scoped CODEX_HOME for the Wanda app-server
// ---------------------------------------------------------------------------
//
// Earlier versions mutated the user's `~/.codex/config.toml` to register the
// Wanda MCP server. That left stale state behind on crashes and clobbered
// any user-authored wanda/wanda-dev sections. Instead we set
// `CODEX_HOME=<APP_DOT_DIR>/codex-app-server/` for the spawned `codex
// app-server` process; that directory holds an isolated `config.toml` plus
// a symlink to the user's `~/.codex/auth.json` so their existing ChatGPT
// or API-key login continues to work.

const USER_CODEX_DIR = join(os.homedir(), '.codex')
const USER_CODEX_CONFIG = join(USER_CODEX_DIR, 'config.toml')
const USER_CODEX_AUTH = join(USER_CODEX_DIR, 'auth.json')
const SCOPED_CODEX_HOME = join(APP_DOT_DIR, 'codex-app-server')
const SCOPED_CODEX_CONFIG = join(SCOPED_CODEX_HOME, 'config.toml')
const SCOPED_CODEX_AUTH = join(SCOPED_CODEX_HOME, 'auth.json')

function getMcpServerPath(): string {
  if (runtimeConfig.mcpServerPath && existsSync(runtimeConfig.mcpServerPath)) {
    return runtimeConfig.mcpServerPath
  }
  const appRoot = runtimeConfig.appRoot
  const distPath = resolve(appRoot, 'electron/mcp/dist/index.js')
  if (existsSync(distPath)) return distPath
  return resolve(appRoot, 'electron/mcp/index.ts')
}

/**
 * Build the TOML content for the scoped app-server config. Single
 * [mcp_servers.<MCP_SECTION>] block pointing at our bundled MCP server, with
 * the runtime HTTP port supplied via env.
 */
function renderScopedCodexConfig(port: number, serverPath: string, includeWandaMcp: boolean): string {
  if (!includeWandaMcp) {
    return ['# Managed by Wanda.', '# Wanda MCP is disabled by the current app-level policy.', ''].join('\n')
  }

  const isTsSource = serverPath.endsWith('.ts')
  const command = isTsSource ? 'npx' : 'node'
  const args = isTsSource ? `["tsx", "${serverPath}"]` : `["${serverPath}"]`

  return [
    `[mcp_servers.${MCP_SECTION}]`,
    'type = "stdio"',
    `command = "${command}"`,
    `args = ${args}`,
    '',
    `[mcp_servers.${MCP_SECTION}.env]`,
    `WANDA_PORT = "${port}"`,
    '',
  ].join('\n')
}

/**
 * Materialise CODEX_HOME for the app-server. Writes config.toml and ensures
 * `auth.json` is symlinked from the user's `~/.codex/auth.json` so the
 * spawned process can re-use existing credentials. Idempotent.
 */
function ensureScopedCodexHome(port: number, serverPath: string, includeWandaMcp: boolean): void {
  mkdirSync(SCOPED_CODEX_HOME, { recursive: true })
  writeFileSync(SCOPED_CODEX_CONFIG, renderScopedCodexConfig(port, serverPath, includeWandaMcp))

  // Refresh the auth symlink — replace anything pre-existing so we always
  // point at the user's current auth.json.
  if (existsSync(USER_CODEX_AUTH)) {
    try {
      const stat = lstatSync(SCOPED_CODEX_AUTH)
      if (stat.isSymbolicLink() || stat.isFile()) unlinkSync(SCOPED_CODEX_AUTH)
    } catch {}
    try {
      symlinkSync(USER_CODEX_AUTH, SCOPED_CODEX_AUTH)
    } catch (err) {
      log.agent.warn(
        `failed to symlink codex auth (${USER_CODEX_AUTH} → ${SCOPED_CODEX_AUTH}); login will be required:`,
        err,
      )
    }
  }
}

/**
 * Remove all lines belonging to [mcp_servers.<MCP_SECTION>] or any of its
 * sub-sections from a TOML string.
 *
 * TOML rule: key-value pairs belong to the most-recently declared section
 * header. We walk lines, track the current section, and skip lines whose
 * section starts with `mcp_servers.<MCP_SECTION>`. Used solely to clean up
 * stale entries left behind by earlier Wanda builds.
 */
function stripWandaMcpFromToml(config: string): string {
  const sectionName = `mcp_servers.${MCP_SECTION}`
  const lines = config.split('\n')
  const out: string[] = []
  let inWanda = false

  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (sectionMatch) {
      const section = (sectionMatch[1] ?? '').trim()
      inWanda = section === sectionName || section.startsWith(`${sectionName}.`)
    }
    if (!inWanda) {
      out.push(line)
    }
  }

  while (out.length > 0 && (out[out.length - 1] ?? '').trim() === '') out.pop()
  return `${out.join('\n')}\n`
}

/**
 * One-shot migration: scrub any `[mcp_servers.wanda*]` blocks from the
 * user's `~/.codex/config.toml`. Earlier Wanda builds wrote them there
 * directly; the scoped CODEX_HOME approach makes them dead weight.
 */
function cleanupLegacyUserMcpConfig(): void {
  try {
    if (!existsSync(USER_CODEX_CONFIG)) return
    const config = readFileSync(USER_CODEX_CONFIG, 'utf-8')
    const cleaned = stripWandaMcpFromToml(config)
    if (cleaned !== config) {
      writeFileSync(USER_CODEX_CONFIG, cleaned)
      log.agent.debug(`removed legacy [mcp_servers.${MCP_SECTION}] from ${USER_CODEX_CONFIG}`)
    }
  } catch (err) {
    log.agent.warn('legacy codex config cleanup failed:', err)
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC message types (Codex App Server protocol over stdio)
// ---------------------------------------------------------------------------

/** Outgoing JSON-RPC request (client → server) */
interface JsonRpcRequest {
  method: string
  id: number
  params?: Record<string, unknown>
}

/** Outgoing JSON-RPC notification (client → server, no id) */
interface JsonRpcNotification {
  method: string
  params?: Record<string, unknown>
}

/** Incoming JSON-RPC response (server → client, has id, no method) */
interface JsonRpcResponse {
  id: number
  result?: unknown
  error?: { message: string; code?: number; data?: unknown }
}

/** Incoming server-initiated request (server → client, has both id and method) — e.g. approval requests */
interface JsonRpcServerRequest {
  id: number
  method: string
  params?: Record<string, unknown>
}

/** Incoming JSON-RPC notification (server → client, has method, no id) */
interface JsonRpcServerNotification {
  method: string
  params?: Record<string, unknown>
}

/** Any message that can arrive on stdout from the app-server */
type JsonRpcIncoming = JsonRpcResponse | JsonRpcServerRequest | JsonRpcServerNotification

/** Shape of a model entry returned by the `model/list` RPC */
interface CodexModelEntry {
  id?: string
  model?: string
  displayName?: string
  isDefault?: boolean
}

// ---------------------------------------------------------------------------
// JSON-RPC Client over stdio
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

class CodexRpcClient {
  private proc: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private emitter = new EventEmitter()

  async spawn(): Promise<void> {
    this.proc = spawn('codex', ['app-server', '--listen', 'stdio://'], {
      cwd: SCOPED_CODEX_HOME,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: globalBinPath(),
        CODEX_HOME: SCOPED_CODEX_HOME,
      },
    })

    this.proc.on('error', (err) => {
      log.agent.error('codex app-server spawn error:', err)
      this.emitter.emit('error', err)
    })

    // Prevent uncaught EPIPE if process exits while we're writing
    this.proc.stdin?.on('error', (err) => {
      log.agent.warn('codex stdin error:', err.message)
    })

    this.proc.on('exit', (code, signal) => {
      const message = `codex app-server exited: code=${code} signal=${signal}`
      if (code === 0) log.agent.debug(message)
      else log.agent.warn(message)
      this.proc = null
      for (const [id, req] of this.pending) {
        req.reject(new Error(`app-server exited (code=${code})`))
        this.pending.delete(id)
      }
    })

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      log.agent.error('[stderr]', chunk.toString())
    })

    const rl = createInterface({ input: this.proc.stdout!, crlfDelay: Number.POSITIVE_INFINITY })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const msg = JSON.parse(line)
        this.handleMessage(msg)
      } catch (err) {
        log.agent.error('failed to parse stdout line:', line, err)
      }
    })
  }

  private handleMessage(msg: JsonRpcIncoming): void {
    // Response to a client request (has id, has result or error, no method)
    if ('id' in msg && !('method' in msg)) {
      const resp = msg as JsonRpcResponse
      const pending = this.pending.get(resp.id)
      if (pending) {
        this.pending.delete(resp.id)
        if (resp.error) {
          pending.reject(new Error(resp.error.message || JSON.stringify(resp.error)))
        } else {
          pending.resolve(resp.result)
        }
      }
      return
    }

    // Server-initiated request (has id AND method) — approval requests
    if ('id' in msg && 'method' in msg) {
      this.emitter.emit('serverRequest', msg as JsonRpcServerRequest)
      return
    }

    // Notification (has method, no id)
    if ('method' in msg) {
      this.emitter.emit('notification', msg as JsonRpcServerNotification)
      return
    }
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.proc?.stdin?.writable) {
      throw new Error('app-server not running')
    }
    const id = this.nextId++
    const msg: JsonRpcRequest = { method, id, ...(params ? { params } : {}) }
    const payload = JSON.stringify(msg)
    log.agent.debug(`[rpc] → ${method} (id=${id})`)
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) => {
          log.agent.debug(`[rpc] ← ${method} (id=${id}) OK`)
          resolve(result)
        },
        reject: (err) => {
          const message = err instanceof Error ? err.message : String(err)
          if (message === 'killed') {
            log.agent.debug(`[rpc] ← ${method} (id=${id}) cancelled during shutdown`)
          } else {
            log.agent.error(`[rpc] ← ${method} (id=${id}) ERR:`, message)
          }
          reject(err)
        },
      })
      const ok = this.proc!.stdin!.write(`${payload}\n`, (err) => {
        if (err) {
          this.pending.delete(id)
          reject(new Error(`stdin write failed: ${err.message}`))
        }
      })
      if (!ok) {
        // Back-pressure — unlikely for small JSON payloads but handle gracefully
        this.proc!.stdin!.once('drain', () => {})
      }
    })
  }

  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.proc?.stdin?.writable) return
    const msg: JsonRpcNotification = { method, ...(params ? { params } : {}) }
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`)
  }

  respond(id: number, result: unknown): void {
    if (!this.proc?.stdin?.writable) return
    this.proc.stdin.write(`${JSON.stringify({ id, result })}\n`)
  }

  respondError(id: number, code: number, message: string): void {
    if (!this.proc?.stdin?.writable) return
    this.proc.stdin.write(`${JSON.stringify({ id, error: { code, message } })}\n`)
  }

  onNotification(callback: (msg: JsonRpcServerNotification) => void): () => void {
    this.emitter.on('notification', callback)
    return () => this.emitter.off('notification', callback)
  }

  onServerRequest(callback: (msg: JsonRpcServerRequest) => void): () => void {
    this.emitter.on('serverRequest', callback)
    return () => this.emitter.off('serverRequest', callback)
  }

  kill(): void {
    if (this.proc) {
      this.proc.kill('SIGTERM')
      this.proc = null
    }
    for (const [, req] of this.pending) {
      req.reject(new Error('killed'))
    }
    this.pending.clear()
  }

  get alive(): boolean {
    return this.proc !== null && !this.proc.killed
  }
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

interface SessionState {
  session: AgentSession
  activeTurnId: string | null
}

export const AgentControllerLive = Layer.sync(AgentController, () => {
  const sessions = new Map<string, SessionState>()
  const emitter = new EventEmitter()
  let rpcClient: CodexRpcClient | null = null
  let initConfig: { port: number; includeWandaMcp: boolean } | null = null
  let initPromise: Promise<void> | null = null
  let initialized = false

  async function ensureInitialized(): Promise<void> {
    if (rpcClient?.alive && initialized) return
    if (initPromise) return initPromise
    if (!initConfig) {
      throw new Error('Agent not initialized')
    }
    const config = initConfig

    initPromise = (async () => {
      let client: CodexRpcClient | null = null
      try {
        cleanupLegacyUserMcpConfig()
        const serverPath = getMcpServerPath()
        ensureScopedCodexHome(config.port, serverPath, config.includeWandaMcp)
        log.agent.debug(`scoped CODEX_HOME ready at ${SCOPED_CODEX_HOME} (port ${config.port})`)

        // Spawn codex app-server only when a legacy topbar session is first used.
        client = new CodexRpcClient()
        await client.spawn()
        rpcClient = client

        await client.request('initialize', {
          clientInfo: {
            name: 'wanda',
            title: 'Wanda',
            version: runtimeConfig.appVersion,
          },
          capabilities: {},
        })
        client.notify('initialized')
        log.agent.debug('codex app-server initialized')

        client.onNotification((msg) => {
          const threadId = msg.params?.threadId as string | undefined

          if (msg.method === 'account/login/completed') {
            if (msg.params?.success) {
              log.agent.info('authentication completed')
            }
            return
          }

          if (msg.method === 'account/updated') {
            return
          }

          if (!threadId) return
          const sessionId = findSessionByThread(threadId)
          if (!sessionId) return

          emitter.emit('message', sessionId, { method: msg.method, params: msg.params ?? {} })

          if (msg.method === 'turn/completed') {
            const state = sessions.get(sessionId)
            if (state) {
              state.session.status = 'idle'
              state.activeTurnId = null
            }
          }
        })

        // Route server-initiated requests. codex blocks the turn until every
        // server-initiated request receives a response, so any method we don't
        // surface MUST still be answered — otherwise the turn hangs forever
        // ("Thinking…" with no end).
        client.onServerRequest((msg) => {
          if (
            msg.method === 'item/commandExecution/requestApproval' ||
            msg.method === 'item/fileChange/requestApproval'
          ) {
            const p = msg.params as Record<string, string | undefined> | undefined
            const req: ApprovalRequest = {
              requestId: msg.id,
              type: msg.method === 'item/commandExecution/requestApproval' ? 'commandExecution' : 'fileChange',
              command: p?.command,
              cwd: p?.cwd,
              reason: p?.reason,
              grantRoot: p?.grantRoot,
            }
            emitter.emit('permissionRequest', req)
            return
          }

          // Anything else — permissions escalation, MCP elicitation, dynamic
          // tool calls, etc. — is a flow we don't implement yet. Reply with an
          // error so codex fails the tool gracefully and finishes the turn
          // instead of waiting on a response that never arrives.
          log.agent.warn(
            `unhandled codex server-request '${msg.method}' (id=${msg.id}); replying with error to avoid a hung turn`,
          )
          client?.respondError(msg.id, -32601, `wanda does not handle ${msg.method}`)
        })

        try {
          const accountInfo = (await client.request('account/read', { refreshToken: false })) as
            | { account?: unknown }
            | undefined
          if (accountInfo?.account) {
            log.agent.debug('already authenticated')
          } else {
            const loginResult = (await client.request('account/login/start', { type: 'chatgpt' })) as
              | { authUrl?: string }
              | undefined
            if (loginResult?.authUrl) {
              emitter.emit('authRequired', loginResult.authUrl)
              runtimeConfig.openExternal(loginResult.authUrl)
            }
          }
        } catch (err) {
          log.agent.error('auth check failed:', err)
        }

        try {
          const modelResult = (await client.request('model/list', {
            cursor: null,
            limit: 50,
            includeHidden: false,
          })) as { data?: CodexModelEntry[] } | undefined
          if (modelResult?.data) {
            const models: CodexModel[] = modelResult.data.map((m) => ({
              id: m.id || m.model || '',
              displayName: m.displayName || m.id || m.model || '',
              isDefault: m.isDefault ?? false,
            }))
            log.agent.debug(`model/list: ${models.length} model(s)`)
            emitter.emit('modelsLoaded', models)
          } else {
            log.agent.warn('model/list returned no data:', modelResult)
          }
        } catch (err) {
          if (err instanceof Error && err.message === 'killed') {
            log.agent.debug('model list cancelled during shutdown')
          } else {
            log.agent.error('model list failed:', err)
          }
        }

        initialized = true
        emitter.emit('ready')
      } catch (err) {
        initialized = false
        if (rpcClient === client) rpcClient = null
        client?.kill()
        throw err
      }
    })().finally(() => {
      initPromise = null
    })

    return initPromise
  }

  return {
    init: (port: number, opts?: { includeWandaMcp?: boolean }) =>
      Effect.sync(() => {
        initConfig = { port, includeWandaMcp: opts?.includeWandaMcp ?? true }
        // The legacy command bar treats "ready" as "can accept a prompt".
        // Actual Codex startup is deferred until the first session request.
        emitter.emit('ready')
      }),

    cleanup: () =>
      Effect.sync(() => {
        for (const [, state] of sessions) {
          state.session.status = 'stopped'
        }
        sessions.clear()

        if (rpcClient) {
          rpcClient.kill()
          rpcClient = null
        }
        initialized = false
        // Scoped CODEX_HOME directory persists between runs — nothing to
        // clean up. The user's `~/.codex/config.toml` is no longer touched.
      }),

    startSession: (opts: { cwd: string; developerInstructions?: string }) =>
      Effect.promise(async () => {
        await ensureInitialized()
        if (!rpcClient?.alive) throw new Error('Agent not initialized')

        const params: Record<string, unknown> = {
          cwd: opts.cwd,
          // The topbar bar is a trusted local assistant the user drives
          // directly, so run privileged actions without prompting. 'never' +
          // full access means codex never emits an approval/permission
          // server-request, so tool calls (spawning terminals, etc.) just work.
          approvalPolicy: 'never',
          sandbox: 'danger-full-access',
        }
        if (opts.developerInstructions) {
          params.developerInstructions = opts.developerInstructions
        }

        const result = (await rpcClient.request('thread/start', params)) as { thread?: { id?: string } } | undefined

        const threadId = result?.thread?.id
        if (!threadId) throw new Error('Failed to start thread')

        const session: AgentSession = {
          id: uuid(),
          threadId,
          status: 'idle',
          cwd: opts.cwd,
        }
        sessions.set(session.id, { session, activeTurnId: null })
        return session
      }),

    sendMessage: (id: string, message: string, model?: string) =>
      Effect.sync(() => {
        const state = sessions.get(id)
        if (!state) throw new Error(`Session ${id} not found`)
        if (!rpcClient?.alive) throw new Error('Agent not initialized')

        const { session } = state
        session.status = 'running'

        const client = rpcClient

        // Fire turn/start in background — don't block the oRPC call
        ;(async () => {
          try {
            const params: Record<string, unknown> = {
              threadId: session.threadId,
              input: [{ type: 'text', text: message, text_elements: [] }],
              cwd: session.cwd,
            }
            if (model) params.model = model

            const result = (await client.request('turn/start', params)) as { turn?: { id?: string } } | undefined
            if (result?.turn?.id) {
              state.activeTurnId = result.turn.id
            }
          } catch (err: unknown) {
            log.agent.error(`turn/start error for session ${id}:`, err)
            session.status = 'idle'
            state.activeTurnId = null
            // Surface the failure to the renderer so the "thinking" spinner
            // clears instead of hanging forever on a turn that never started.
            emitter.emit('message', id, { method: 'turn/completed', params: { turn: { status: 'completed' } } })
          }
        })()
      }),

    stopSession: (id: string) =>
      Effect.promise(async () => {
        const state = sessions.get(id)
        if (!state) return

        if (state.activeTurnId && state.session.threadId && rpcClient?.alive) {
          try {
            await rpcClient.request('turn/interrupt', {
              threadId: state.session.threadId,
              turnId: state.activeTurnId,
            })
          } catch {}
        }

        state.session.status = 'stopped'
        sessions.delete(id)
      }),

    list: () => Effect.sync(() => Array.from(sessions.values()).map((s) => s.session)),

    onMessage: (callback: (id: string, msg: CodexEvent) => void) => {
      emitter.on('message', callback)
      return () => emitter.off('message', callback)
    },

    onPermissionRequest: (callback: (req: ApprovalRequest) => void) => {
      emitter.on('permissionRequest', callback)
      return () => emitter.off('permissionRequest', callback)
    },

    resolvePermission: (requestId: number, decision: 'accept' | 'acceptForSession' | 'decline') => {
      if (!rpcClient?.alive) return
      rpcClient.respond(requestId, { decision })
    },

    onAuthRequired: (callback: (authUrl: string) => void) => {
      emitter.on('authRequired', callback)
      return () => emitter.off('authRequired', callback)
    },

    onModelsLoaded: (callback: (models: CodexModel[]) => void) => {
      emitter.on('modelsLoaded', callback)
      return () => emitter.off('modelsLoaded', callback)
    },

    onReady: (callback: () => void) => {
      emitter.on('ready', callback)
      return () => emitter.off('ready', callback)
    },
  }

  function findSessionByThread(threadId: string): string | undefined {
    for (const [sessionId, state] of sessions) {
      if (state.session.threadId === threadId) return sessionId
    }
    return undefined
  }
})
