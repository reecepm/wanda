// -----------------------------------------------------------------------------
// Subprocess server strategy.
//
// Spawns `electron/server/bin.ts` via Node, reads a JSON handshake line from
// its stdout (port + session token), creates an HTTP oRPC client, and opens a
// WebSocket to the /events endpoint to mirror broadcasts into the shell's own
// broadcast function. Crashes auto-restart with full-jitter backoff; the
// returned `client` is a live proxy that transparently follows restarts.
// -----------------------------------------------------------------------------

import { spawn } from 'node:child_process'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { encodeEnvelope, makeEnvelope, PROTOCOL_VERSION, parseEnvelope } from '@wanda/wire'
import { WebSocket } from 'ws'
import { log } from '../packages/logger'
import type { AppClient, ShellServerHandle } from './server-handle'

export interface SubprocessOpts {
  /** Path to the server entry script (electron/server/bin.ts or its compiled equivalent). */
  readonly serverEntry: string
  /** Node executable to spawn with. Default: process.execPath. */
  readonly nodeExecPath?: string
  /** Environment variables to pass to the child. */
  readonly env: NodeJS.ProcessEnv
  /** Callback for broadcast events arriving from the child's WS /events channel. */
  readonly onBroadcast: (channel: string, args: ReadonlyArray<unknown>) => void
  /** Optional host override (default: 127.0.0.1). */
  readonly host?: string
  /** Optional port override (default: 0 = ephemeral, selected by the child). */
  readonly port?: number
  /**
   * Called when the subprocess crashes unexpectedly and the handle schedules
   * a restart. Lets the shell surface status in the UI (e.g. a toast) or
   * invalidate its TanStack Query cache so the next render sees fresh data.
   */
  readonly onCrash?: (info: {
    code: number | null
    signal: NodeJS.Signals | null
    attempt: number
    nextRetryInMs: number
  }) => void
  /**
   * Called after a restarted subprocess has re-handshaked and the HTTP +
   * WS clients have been swapped over. The shell should re-broadcast a
   * `server:reconnected` event so the renderer can invalidate caches.
   */
  readonly onRestart?: () => void
  /** Max restart attempts before giving up. Default: Infinity. */
  readonly maxRestarts?: number
}

/**
 * Full-jitter exponential backoff, capped at 10s. Attempt counter resets
 * after a subprocess has been alive long enough to be considered "stable".
 */
function nextBackoffMs(attempt: number): number {
  const cap = 10_000
  const base = 250
  const ceiling = Math.min(cap, base * 2 ** attempt)
  return Math.floor(Math.random() * ceiling)
}

/**
 * Return a proxy whose property accesses resolve against the current value
 * returned by `getCurrent()` at call time. Used to give the shell a stable
 * `handle.client` reference that transparently follows subprocess
 * restarts: when the child is replaced, the underlying oRPC client is
 * swapped but the proxy keeps forwarding to whichever one is live.
 *
 * The proxy walks arbitrary nesting depth (e.g. `client.workspace.create`)
 * by recording the path via `get` and only touching the real client when
 * the leaf is actually invoked. Promise-thenable probes are handled so the
 * proxy doesn't accidentally look like a thenable.
 */
function makeLiveClient<T extends object>(getCurrent: () => unknown, path: ReadonlyArray<string> = []): T {
  const handler: ProxyHandler<() => void> = {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined
      if (prop === 'then') return undefined
      return makeLiveClient(getCurrent, [...path, prop])
    },
    apply(_target, _thisArg, args) {
      const current = getCurrent()
      if (current == null) {
        throw new Error('subprocess client not available (restart in progress?)')
      }
      // oRPC sub-proxies are callable, so walking the path traverses
      // through both plain objects and callable function-proxies.
      const navigable = (v: unknown): v is Record<string, unknown> =>
        v != null && (typeof v === 'object' || typeof v === 'function')

      let fn: unknown = current
      for (const segment of path) {
        if (!navigable(fn)) {
          throw new TypeError(`client.${path.join('.')}: path broke at ${segment}`)
        }
        fn = fn[segment]
      }
      if (typeof fn !== 'function') {
        throw new TypeError(`client.${path.join('.')} is not a function`)
      }
      // Call the leaf directly without rebinding `this` — oRPC's client
      // proxies capture their path internally, so rebinding via .apply()
      // would confuse their closure.
      return (fn as (...a: unknown[]) => unknown)(...args)
    },
  }
  // Proxy target must be a function so the `apply` trap is callable.
  return new Proxy<() => void>(() => {}, handler) as unknown as T
}

interface HandshakeMessage {
  readonly type: 'wanda-server-ready'
  readonly host: string
  readonly port: number
  readonly token: string
}

/** Minimal handle the subprocess restart loop needs for tearing down the events WS. */
export interface EventWsHandle {
  close(): void
}

/**
 * Live connection to one subprocess incarnation. Created fresh on every
 * spawn; swapped into `SubprocessRuntimeState` on restart.
 */
interface SubprocessConnection {
  readonly child: ReturnType<typeof spawn>
  readonly client: AppClient
  readonly wsClient: EventWsHandle
  readonly handshake: HandshakeMessage
}

/**
 * Test-only WeakMap that maps a subprocess handle to its internal state.
 * Exported via `__getSubprocessRuntimeStateForTest` and used only by
 * `subprocess-handle.test.ts` to reach into the subprocess PID for
 * crash-and-restart assertions. Not part of the public API.
 */
const runtimeStates = new WeakMap<ShellServerHandle, SubprocessRuntimeState>()

/** @internal test-only */
export function __getSubprocessRuntimeStateForTest(handle: ShellServerHandle): SubprocessRuntimeState | undefined {
  return runtimeStates.get(handle)
}

/**
 * Mutable state shared between the stable `ShellServerHandle` returned to
 * the caller and the restart loop. The proxy-based `client` reads the
 * current connection through `state.conn` on every call, so swapping the
 * connection transparently swaps what the shell's in-flight calls target.
 */
interface SubprocessRuntimeState {
  conn: SubprocessConnection | null
  /**
   * Handshake values pinned after the first successful spawn. Restarts
   * reuse the same port + token so `handle.connection` stays stable and
   * any in-flight WS subscribers don't have to reconnect to a new URL.
   */
  pinned: { host: string; port: number; token: string } | null
  stopping: boolean
  attempt: number
  stableSince: number
}

async function spawnAndHandshake(opts: SubprocessOpts, state: SubprocessRuntimeState): Promise<SubprocessConnection> {
  const nodeExec = opts.nodeExecPath ?? process.execPath
  // On restarts, pin port to whatever the first spawn ended up with so the
  // `handle.connection` URL stays stable. The child mints its own session
  // token on every boot and advertises it via the stdout handshake.
  const host = state.pinned?.host ?? opts.host ?? '127.0.0.1'
  const port = state.pinned ? String(state.pinned.port) : String(opts.port ?? 0)
  const child = spawn(nodeExec, [opts.serverEntry], {
    env: {
      ...opts.env,
      WANDA_HOST: host,
      WANDA_PORT: port,
      // Force the child to print a JSON handshake line on stdout so we
      // can discover its port + token without env/file dances.
      WANDA_HANDSHAKE_STDOUT: '1',
      // Don't let the child inherit Electron's RUN_AS_NODE flag.
      ELECTRON_RUN_AS_NODE: undefined,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Pipe child stderr into the shell logger.
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[server] ${chunk.toString()}`)
  })

  // Read the handshake line from stdout. Everything after it streams to logs.
  const handshake = await new Promise<HandshakeMessage>((resolve, reject) => {
    let buf = ''
    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) {
        reject(new Error('subprocess handshake timed out after 30s'))
      }
    }, 30_000)

    const onData = (chunk: Buffer): void => {
      buf += chunk.toString()
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      const firstLine = buf.slice(0, nl)
      const rest = buf.slice(nl + 1)
      try {
        const msg = JSON.parse(firstLine) as HandshakeMessage
        if (msg.type === 'wanda-server-ready') {
          resolved = true
          clearTimeout(timeout)
          child.stdout?.off('data', onData)
          if (rest.length > 0) process.stdout.write(`[server] ${rest}`)
          child.stdout?.on('data', (c: Buffer) => process.stdout.write(`[server] ${c.toString()}`))
          resolve(msg)
          return
        }
      } catch {
        // Not JSON — assume normal stdout.
      }
      process.stdout.write(`[server] ${buf}`)
      buf = ''
    }
    child.stdout?.on('data', onData)

    child.on('exit', (code, signal) => {
      if (!resolved) {
        clearTimeout(timeout)
        reject(new Error(`subprocess exited before handshake (code=${code}, signal=${signal})`))
      }
    })
    child.on('error', (err) => {
      if (!resolved) {
        clearTimeout(timeout)
        reject(err)
      }
    })
  })

  log.main.info(`subprocess ready at ${handshake.host}:${handshake.port}`)

  const httpBase = `http://${handshake.host}:${handshake.port}`
  const wsUrl = `ws://${handshake.host}:${handshake.port}/events`

  const link = new RPCLink({
    url: httpBase,
    headers: { authorization: `Bearer ${handshake.token}` },
  })
  const client = createORPCClient<AppClient>(link)
  const wsClient = connectEventWs(httpBase, wsUrl, handshake.token, opts.onBroadcast)

  // Install the unexpected-exit handler now that the handshake succeeded.
  child.on('exit', (code, signal) => {
    if (state.stopping) return
    if (state.conn?.child !== child) return // already superseded by a restart
    log.main.error(`subprocess exited unexpectedly (code=${code}, signal=${signal})`)
    void scheduleRestart(opts, state, code, signal)
  })

  return { child, client, wsClient, handshake }
}

const STABLE_UPTIME_MS = 5_000
const DEFAULT_MAX_RESTARTS = Number.POSITIVE_INFINITY

async function scheduleRestart(
  opts: SubprocessOpts,
  state: SubprocessRuntimeState,
  code: number | null,
  signal: NodeJS.Signals | null,
): Promise<void> {
  const limit = opts.maxRestarts ?? DEFAULT_MAX_RESTARTS
  if (state.attempt >= limit) {
    log.main.error(`subprocess restart limit reached (${limit}); giving up`)
    state.conn = null
    return
  }

  state.attempt += 1
  const delay = nextBackoffMs(state.attempt)
  opts.onCrash?.({ code, signal, attempt: state.attempt, nextRetryInMs: delay })

  try {
    state.conn?.wsClient.close()
  } catch {
    // ignore
  }
  state.conn = null

  log.main.info(`scheduling subprocess restart #${state.attempt} in ${delay}ms`)
  await new Promise((r) => setTimeout(r, delay))
  if (state.stopping) return

  try {
    const newConn = await spawnAndHandshake(opts, state)
    state.conn = newConn
    state.stableSince = Date.now()
    log.main.info(`subprocess restart #${state.attempt} succeeded`)
    opts.onRestart?.()
    // Reset the attempt counter if the subprocess stays alive for long
    // enough. Checked lazily on the next crash.
  } catch (err) {
    log.main.error(`subprocess restart #${state.attempt} failed:`, err)
    void scheduleRestart(opts, state, null, null)
  }
}

export async function createSubprocessHandle(opts: SubprocessOpts): Promise<ShellServerHandle> {
  const state: SubprocessRuntimeState = {
    conn: null,
    pinned: null,
    stopping: false,
    attempt: 0,
    stableSince: 0,
  }

  // Initial spawn. If this fails we throw — the shell can't come up.
  const initialConn = await spawnAndHandshake(opts, state)
  state.conn = initialConn
  state.stableSince = Date.now()
  // Pin port + token so restarts reuse them and `connection` stays stable.
  state.pinned = {
    host: initialConn.handshake.host,
    port: initialConn.handshake.port,
    token: initialConn.handshake.token,
  }

  // Record the initial connection URL + token for anyone that needs to
  // open an additional client against the subprocess (e.g. the WS preload
  // transport). These stay stable across restarts: the child rebinds its
  // HTTP server to the same port (WANDA_PORT is pinned in the subprocess
  // env via `spawnAndHandshake`) and re-mints a session token per boot.
  const connection = {
    httpUrl: `http://${initialConn.handshake.host}:${initialConn.handshake.port}`,
    wsUrl: `ws://${initialConn.handshake.host}:${initialConn.handshake.port}/events`,
    token: initialConn.handshake.token,
  }

  // Live proxy: every call resolves against `state.conn?.client` at
  // invocation time, so subprocess restarts are transparent to the shell.
  const clientProxy = makeLiveClient<AppClient>(() => state.conn?.client)

  const stop = async (): Promise<void> => {
    if (state.stopping) return
    state.stopping = true
    const conn = state.conn
    if (!conn) {
      log.main.info('subprocess already stopped')
      return
    }
    try {
      conn.wsClient.close()
    } catch {
      // ignore
    }
    if (conn.child.exitCode === null && conn.child.signalCode === null) {
      conn.child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          try {
            conn.child.kill('SIGKILL')
          } catch {
            // ignore
          }
          resolve()
        }, 5000)
        conn.child.once('exit', () => {
          clearTimeout(t)
          resolve()
        })
      })
    }
    state.conn = null
    log.main.info('subprocess stopped')
  }

  // Reset the restart attempt counter after the subprocess has been
  // stable for long enough. This avoids the "flapping server" case
  // where repeated crashes keep bumping the backoff forever.
  const resetStableAttempts = () => {
    if (state.conn && Date.now() - state.stableSince > STABLE_UPTIME_MS) {
      state.attempt = 0
    }
  }

  const handle: ShellServerHandle = {
    mode: 'subprocess',
    client: clientProxy,
    connection,
    destroyAllPtys: () => {
      // No-op in subprocess mode — the child owns its PTYs.
    },
    connectAndRecover: async () => {
      // The child fires connectAndRecover() internally via bin.ts.
    },
    stop,
    getRunningPodCount: async () => {
      resetStableAttempts()
      return clientProxy.pod.countByStatus({ status: 'running' })
    },
    getCloseToTray: async () => {
      resetStableAttempts()
      const val = await clientProxy.settings.get({ key: 'app.closeToTray' })
      return val === 'true'
    },
    getUnresolvedCounts: async () => {
      resetStableAttempts()
      const counts = await clientProxy.notification.unresolvedCounts()
      return { totalBlocking: counts.totalBlocking }
    },
  }
  runtimeStates.set(handle, state)
  return handle
}

// -----------------------------------------------------------------------------
// WebSocket event subscriber
// -----------------------------------------------------------------------------

/**
 * Open an events WS against a subprocess. Goes through the same wsToken +
 * hello flow as the renderer's preload transport — the subprocess gateway
 * no longer accepts static bearer tokens. We mint a one-shot wsToken via
 * POST /api/auth/ws-token, open the upgrade with `?wsToken=…`, send
 * `sys:hello`, and only start forwarding envelopes after `sys:hello-ack`.
 *
 * Returns a handle exposing `close()` so the subprocess restart loop can
 * tear the socket down on shutdown. Because the WS upgrade depends on an
 * async wsToken mint, the handle is stable from the moment we return it
 * even though the underlying `ws` instance is created a tick later.
 */
function connectEventWs(
  httpBase: string,
  wsUrl: string,
  sessionToken: string,
  onBroadcast: (channel: string, args: ReadonlyArray<unknown>) => void,
): EventWsHandle {
  let live: WebSocket | null = null
  let disposed = false

  void (async (): Promise<void> => {
    let wsToken: string | null = null
    try {
      const res = await fetch(`${httpBase}/api/auth/ws-token`, {
        method: 'POST',
        headers: { authorization: `Bearer ${sessionToken}` },
      })
      if (res.ok) {
        const body = (await res.json()) as { wsToken?: string }
        wsToken = typeof body.wsToken === 'string' ? body.wsToken : null
      }
    } catch (err) {
      log.main.warn('subprocess ws-token mint failed:', err)
    }
    if (!wsToken) {
      log.main.error('subprocess ws-token mint returned no token; events channel will not connect')
      return
    }
    if (disposed) return
    const upgradeUrl = `${wsUrl}?wsToken=${encodeURIComponent(wsToken)}`
    live = new WebSocket(upgradeUrl, { perMessageDeflate: false })
    let helloAcked = false
    live.on('open', () => {
      log.main.debug(`subprocess events WS connected: ${upgradeUrl}`)
      try {
        live?.send(
          encodeEnvelope(makeEnvelope('sys:hello', [{ v: PROTOCOL_VERSION, clientId: 'wanda-subprocess-consumer' }])),
        )
      } catch (err) {
        log.main.warn('subprocess events WS hello send failed:', err)
      }
    })
    live.on('message', (raw: Buffer) => {
      const envelope = parseEnvelope(raw.toString())
      if (!envelope) return
      if (envelope.channel === 'sys:hello-ack') {
        helloAcked = true
        return
      }
      if (envelope.channel === 'sys:hello-rejected') {
        log.main.error('subprocess hello-rejected:', envelope.args?.[0])
        return
      }
      if (!helloAcked) return
      if (envelope.channel === 'sys:ping') {
        if (live?.readyState === WebSocket.OPEN) {
          try {
            live.send(encodeEnvelope(makeEnvelope('sys:pong', [])))
          } catch {
            /* ignore */
          }
        }
        return
      }
      if (envelope.channel.startsWith('sys:')) return
      onBroadcast(envelope.channel, envelope.args ?? [])
    })
    live.on('close', (code) => {
      log.main.warn(`subprocess events WS closed (code=${code})`)
    })
    live.on('error', (err) => {
      log.main.error('subprocess events WS error:', err)
    })
  })()

  return {
    close(): void {
      disposed = true
      try {
        live?.close()
      } catch {
        /* ignore */
      }
    },
  }
}
