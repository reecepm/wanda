// -----------------------------------------------------------------------------
// Electron shell entry point.
//
// Thin shell: creates windows, hosts the tray, forwards native keyboard
// intercepts, and spawns OR embeds the Wanda server runtime. All renderer ↔
// server communication goes through the WebSocket transport (HTTP for RPC,
// WS for events) — there is no IPC bridge for RPC calls anymore.
//
// Server runtime mode is selected by WANDA_SERVER_MODE:
//   embedded   — runs `createServerRuntime()` in-process and attaches a
//                WsGateway to the in-process HTTP server. The renderer
//                connects to 127.0.0.1:<port> via WS just like the
//                subprocess case. Default.
//   subprocess — spawns `out/main/server.js` as a child, reads the
//                stdout handshake, connects HTTP + WS. Crash-safe via
//                the restart loop in shell/server-handle.ts.
//
// IPC is used only for Electron-local concerns:
//   - BrowserWindow events (close, before-input-event)
//   - Main → renderer keyboard intercept forwarding (terminal:zoom,
//     shortcut:forward, app:navigate) — these are synthesized in main
//     from native events, not pushed by the server
//   - shell:openExternal (tray → main → Electron `shell` module)
//   - tray:navigate / tray:invalidate (tray window → main)
// -----------------------------------------------------------------------------

import { existsSync } from 'node:fs'
import { hostname as osHostname } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, nativeImage, session, shell } from 'electron'
import dockIcon from '../resources/dock-icon.png?asset'
import dockIconDev from '../resources/dock-icon-dev.png?asset'
import { APP_DOT_DIR, APP_ID, APP_NAME, DB_FILENAME, isDev } from './app-config'
import { configureSecretStore, createAesSecretStore, loadOrCreateSecretKey } from './infra/secret-store'
import { ensureGlobalGitignore } from './packages/agent-hooks'
import { log } from './packages/logger'
import { configureAgentRuntime, configureDatabase } from './services'
import { type ClientDb, createClientDb } from './shell/client-db'
import { registerOutboxIpc } from './shell/outbox-ipc'
import { createOutboxService, type OutboxService } from './shell/outbox-service'
import {
  createEmbeddedHandle,
  createSubprocessHandle,
  type LocalServerHandle,
  type ServerMode,
  type ShellServerHandle,
} from './shell/server-handle'
import { createServerRegistry, type ServerRegistry } from './shell/server-registry'
import { registerServerRegistryIpc } from './shell/server-registry-ipc'
import { TrayManager } from './tray/tray-manager'

// -----------------------------------------------------------------------------
// Module-level shell state
// -----------------------------------------------------------------------------

// Defense-in-depth for EPIPE / ERR_STREAM_DESTROYED from PTY host
// subprocess writes during shutdown. Without this, Electron's default
// uncaughtException handler shows a native error dialog, which is
// disruptive when the app is about to quit anyway. Tighter checks and
// try/catch live inside the terminal-engine sendFrame path; this is
// just the last-resort net so nothing slips through to the dialog.
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) {
    log.main.debug('[main] swallowed stdin error during shutdown:', err.message)
    return
  }
  log.main.error('[main] uncaughtException:', err)
  if (process.env.WANDA_HEADLESS === '1') return
  // Re-throw for anything genuinely unexpected so Electron's default
  // handler still surfaces real crashes during development.
  throw err
})

let mainWindow: BrowserWindow | null = null
const appWindows = new Set<BrowserWindow>()
let trayManagerRef: TrayManager | null = null
let serverHandle: ShellServerHandle | null = null
let localServerRef: LocalServerHandle | null = null
let clientDbRef: ClientDb | null = null
let serverRegistryRef: ServerRegistry | null = null
let outboxServiceRef: OutboxService | null = null
let teardownServersIpc: (() => void) | null = null
let teardownOutboxIpc: (() => void) | null = null
let quitting = false
/**
 * Cached close-to-tray setting. Refreshed at boot and after any settings
 * mutation through the renderer's WS client. Kept as a plain boolean so
 * the window-close handler can decide synchronously without blocking on
 * an async RPC round-trip.
 */
let closeToTrayCache = false
// True when attention mode forced the main window visible from a hidden state.
// Used to restore the hidden state once the attention queue drains.
let attentionHidMainWindow = false

const MCP_PORT_FILE = join(APP_DOT_DIR, 'mcp-port')
const SERVER_MODE: ServerMode = (process.env.WANDA_SERVER_MODE ?? 'embedded') as ServerMode

// Electron's default dev identity is derived from package metadata ("wanda"),
// which collides with packaged "Wanda" on case-insensitive macOS filesystems.
// Set the identity before taking the single-instance lock so dev and stable
// can run side-by-side instead of dev being routed to the stable instance.
app.setName(APP_NAME)
app.setAppUserModelId(APP_ID)

// Support a scratch user-data directory for E2E tests. Must run before any
// code touches `app.getPath('userData')` — so it lives here at module scope
// rather than inside `whenReady`. Each Playwright instance passes a unique
// temp dir so two side-by-side launches don't share a DB / secret key /
// session store.
if (process.env.WANDA_USER_DATA_DIR) {
  app.setPath('userData', process.env.WANDA_USER_DATA_DIR)
} else {
  app.setPath('userData', join(app.getPath('appData'), APP_NAME))
}

const singleInstanceLock = app.requestSingleInstanceLock()
if (!singleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!serverHandle) return
    const win = createWindow()
    setupWindow(win)
    win.once('ready-to-show', () => {
      if (process.env.WANDA_HEADLESS !== '1') win.show()
      win.focus()
    })
  })
}

// -----------------------------------------------------------------------------
// Window event dispatch — only used for Electron-local channels that main
// generates from native input (terminal zoom, shortcut forwarding, app
// navigation from tray). Everything else flows over the server's WS gateway
// directly to each window's preload, so main.ts doesn't see it at all.
// -----------------------------------------------------------------------------

/** Send a main-generated event to the main window + tray window. */
function sendLocalEvent(channel: string, ...args: unknown[]): void {
  for (const win of appWindows) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
  trayManagerRef?.send(channel, ...args)
}

/** Recompute the dock / tray badges from current unresolved-notification counts. */
async function updateDockBadge(): Promise<void> {
  if (!serverHandle) return
  try {
    const counts = await serverHandle.getUnresolvedCounts()
    app.dock?.setBadge(counts.totalBlocking > 0 ? String(counts.totalBlocking) : '')
    app.setBadgeCount(counts.totalBlocking)
    trayManagerRef?.setBlockingNotificationCount(counts.totalBlocking)
  } catch (err) {
    log.main.warn('updateDockBadge failed:', err)
  }

  if (trayManagerRef) {
    try {
      const count = await serverHandle.getRunningPodCount()
      trayManagerRef.setRunningPodCount(count)
    } catch (err) {
      log.main.warn('getRunningPodCount failed:', err)
    }
  }
}

/**
 * Pull the current `app.closeToTray` setting from the server and cache it
 * locally for the synchronous window-close handler.
 */
function refreshCloseToTrayCache(): void {
  if (!serverHandle) return
  serverHandle
    .getCloseToTray()
    .then((value) => {
      closeToTrayCache = value
    })
    .catch((err) => log.main.warn('refreshCloseToTrayCache failed:', err))
}

// -----------------------------------------------------------------------------
// Window creation + keyboard intercept
// -----------------------------------------------------------------------------

/**
 * Build the additionalArguments list the preload parses to connect to the
 * server. Both the main BrowserWindow and the tray BrowserWindow share this
 * list so they use the same URL + token.
 */
function buildPreloadArgs(): ReadonlyArray<string> {
  const conn = serverHandle?.connection
  if (!conn) {
    throw new Error('server runtime must be booted before creating windows')
  }
  return [`--wanda-http-url=${conn.httpUrl}`, `--wanda-ws-url=${conn.wsUrl}`, `--wanda-token=${conn.token}`]
}

function setupWindow(win: BrowserWindow): void {
  // Window close only tears down the renderer-side client. The server owns
  // PTY lifetime; other windows may still be attached to the same terminals.
  win.on('closed', () => {
    appWindows.delete(win)
    if (mainWindow === win) {
      mainWindow = [...appWindows].find((w) => !w.isDestroyed()) ?? null
    }
  })

  // Intercept Cmd shortcuts so they work even when xterm has focus.
  // Keys that must remain native (copy, paste, cut, select-all, undo/redo).
  // Everything else with Cmd held is forwarded so custom shortcut bindings
  // work even when xterm has focus.
  const NATIVE_KEYS = new Set(['c', 'v', 'x', 'a', 'z', 'backspace', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'])
  win.webContents.on('before-input-event', (event, input) => {
    if (!input.meta || input.type !== 'keyDown') return
    if (input.key === '=' || input.key === '+') {
      win.webContents.send('terminal:zoom', 'in')
      event.preventDefault()
    } else if (input.key === '-') {
      win.webContents.send('terminal:zoom', 'out')
      event.preventDefault()
    } else if (input.key === '0') {
      win.webContents.send('terminal:zoom', 'reset')
      event.preventDefault()
    } else if (!NATIVE_KEYS.has(input.key.toLowerCase())) {
      const key = input.key.length === 1 ? input.key.toUpperCase() : input.key
      win.webContents.send('shortcut:forward', `Mod+${key}`, input.shift, input.alt)
      event.preventDefault()
    }
  })
}

function getInternalRendererRoute(targetUrl: string, currentUrl: string): string | null {
  if (!currentUrl) return null
  try {
    const target = new URL(targetUrl)
    const current = new URL(currentUrl)
    if (!target.hash.startsWith('#/')) return null

    if (target.protocol === 'file:' && current.protocol === 'file:' && target.pathname === current.pathname) {
      return target.hash.slice(1)
    }
    if (
      (target.protocol === 'http:' || target.protocol === 'https:') &&
      target.origin === current.origin &&
      target.pathname === current.pathname
    ) {
      return target.hash.slice(1)
    }
  } catch (err) {
    log.main.error('internal renderer route parse failed', { targetUrl, currentUrl, err })
  }
  return null
}

/**
 * Install a Content-Security-Policy on the default session's renderer
 * responses. The renderer is a same-origin SPA (file:// in prod, the Vite
 * dev origin in dev) that talks to the loopback server over HTTP + WS, so
 * the policy locks scripts to 'self' while allowing the inline splash styles
 * and the loopback connect targets. Dev additionally needs 'unsafe-eval' +
 * 'unsafe-inline' for Vite HMR and its websocket.
 *
 * Embedded `<webview>` content is governed by its own origin/CSP, not this
 * policy — it loads in a separate frame, so external sites still render.
 */
function installContentSecurityPolicy(): void {
  const dev = Boolean(process.env.ELECTRON_RENDERER_URL)
  const scriptSrc = dev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'wasm-unsafe-eval'"
  const connectSrc = [
    "'self'",
    'http://127.0.0.1:*',
    'http://localhost:*',
    'ws://127.0.0.1:*',
    'ws://localhost:*',
    ...(dev && process.env.ELECTRON_RENDERER_URL ? [process.env.ELECTRON_RENDERER_URL] : []),
  ].join(' ')
  const policy = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    // Workspace icons are git-host avatars. `github.com/<owner>.png`
    // 302-redirects to avatars.githubusercontent.com, so both hosts must be
    // allowed (CSP re-checks redirect targets). Bitbucket serves from its own
    // origin. Without these the <img> is blocked and falls back to the initial.
    "img-src 'self' data: blob: https://github.com https://avatars.githubusercontent.com https://bitbucket.org",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    // The embedded browser <webview> navigates to arbitrary external sites;
    // it runs out-of-process with its own CSP, but keep frame-src permissive
    // so the embedder doesn't block its initial load.
    'frame-src https: http:',
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}

function createWindow(): BrowserWindow {
  const iconPath = isDev ? dockIconDev : dockIcon
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 256, height: 256 })
  app.dock?.setIcon(icon)

  const preloadArgs = buildPreloadArgs()

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    titleBarStyle: 'hiddenInset',
    transparent: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      additionalArguments: [...preloadArgs],
    },
  })
  appWindows.add(win)
  mainWindow = win

  // Route `target="_blank"`, `window.open`, and middle-click navigations to
  // the OS browser via `shell.openExternal`. Without this Electron's default
  // is to spawn a barebones BrowserWindow popup.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const internalRoute = getInternalRendererRoute(url, win.webContents.getURL())
    if (internalRoute) {
      win.webContents.send('app:navigate', internalRoute)
      return { action: 'deny' }
    }

    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url).catch((err) => {
          log.main.warn('shell.openExternal failed', { url, err })
        })
      }
    } catch (err) {
      log.main.error('windowOpenHandler invalid URL', { url, err })
    }
    return { action: 'deny' }
  })

  // Block in-window navigations away from the renderer (e.g. dragging a link
  // onto the window, or stray `location.href = ...`). External URLs hand off
  // to the OS browser; same-origin renderer routes are left alone.
  win.webContents.on('will-navigate', (event, url) => {
    const currentUrl = win.webContents.getURL()
    try {
      const target = new URL(url)
      const current = currentUrl ? new URL(currentUrl) : null
      if (current && target.origin === current.origin) return
      event.preventDefault()
      if (target.protocol === 'http:' || target.protocol === 'https:') {
        shell.openExternal(url).catch((err) => {
          log.main.warn('shell.openExternal failed', { url, err })
        })
      }
    } catch (err) {
      event.preventDefault()
      log.main.error('will-navigate invalid URL', { url, err })
    }
  })

  // Close-to-tray: hide window instead of quitting when setting is enabled.
  win.on('close', (event) => {
    if (quitting) return
    if (closeToTrayCache) {
      event.preventDefault()
      win.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

// -----------------------------------------------------------------------------
// Server boot — picks embedded vs subprocess based on WANDA_SERVER_MODE.
// Both modes attach a WsGateway; the renderer always connects over WS.
// -----------------------------------------------------------------------------

async function bootServer(): Promise<ShellServerHandle> {
  if (SERVER_MODE === 'subprocess') {
    localServerRef = null
    // The server entry is built by electron-vite as out/main/server.js
    // alongside main.js (see electron.vite.config.ts).
    const serverEntry = process.env.WANDA_SERVER_ENTRY ?? join(__dirname, 'server.js')
    if (!existsSync(serverEntry)) {
      throw new Error(
        `WANDA_SERVER_MODE=subprocess requires the server build, but none was found at ${serverEntry}. ` +
          'Run `bunx electron-vite build` first (or set WANDA_SERVER_ENTRY to an existing path).',
      )
    }
    log.main.info(`spawning server subprocess: ${serverEntry}`)
    return createSubprocessHandle({
      serverEntry,
      env: {
        ...process.env,
        WANDA_DATA_DIR: APP_DOT_DIR,
        WANDA_USER_DATA_DIR: app.getPath('userData'),
        WANDA_APP_ROOT: app.getAppPath(),
        WANDA_MCP_SERVER_PATH: app.isPackaged
          ? join(process.resourcesPath, 'mcp/index.js')
          : join(app.getAppPath(), 'electron/mcp/dist/index.js'),
        WANDA_APP_VERSION: app.getVersion(),
      },
      onBroadcast: () => {
        // In WS mode the renderer subscribes directly to the subprocess
        // gateway, so forwarding events to windows from main would just
        // duplicate deliveries. Main only uses onBroadcast for its own
        // local concerns (dock badge refresh triggered on
        // notifications:changed etc.) — wired below via targeted local
        // listeners rather than a generic fan-out.
      },
      onCrash: ({ attempt, nextRetryInMs }) => {
        log.main.error(`server subprocess crashed; restart attempt #${attempt} in ${nextRetryInMs}ms`)
      },
      onRestart: () => {
        log.main.info('server subprocess restarted; invalidating renderer caches')
        // The Electron-local event bridge in preload.ts doesn't see this
        // because there's no ipcRenderer.on('orpc:invalidate') listener
        // in WS mode. For subprocess restarts, the renderer's WS client
        // auto-reconnects and should re-subscribe, but we also trigger
        // a full cache refetch from the shell side by telling each
        // window to reload its queries via a dedicated `shell:reconnect`
        // channel. (The renderer listens for this in WS mode.)
        sendLocalEvent('shell:reconnect')
      },
    })
  }

  const { handle, local } = await createEmbeddedHandle({
    runtimeOpts: {
      snapshotStoreDir: app.getPath('userData'),
      mcpPortFile: MCP_PORT_FILE,
    },
    appVersion: app.getVersion(),
    onNotificationsChanged: () => {
      // Refresh the local dock/tray badge after any notification mutation.
      // The renderer receives the `notifications:changed` event directly
      // via its WS client.
      void updateDockBadge()
    },
  })
  localServerRef = local
  log.main.info(`local server listening on ${local.listenHost}:${local.port} (serverId=${local.serverId})`)
  return handle
}

// -----------------------------------------------------------------------------
// whenReady — the single bootstrap path
// -----------------------------------------------------------------------------

if (singleInstanceLock) {
  app
    .whenReady()
    .then(async () => {
      // Disable macOS press-and-hold accent menu so key repeat works in terminals.
      // This only affects this app — the user's global setting is unchanged.
      if (process.platform === 'darwin') {
        const { execFileSync } = await import('node:child_process')
        try {
          execFileSync('defaults', ['write', app.getName(), 'ApplePressAndHoldEnabled', '-bool', 'false'])
        } catch (err) {
          log.main.warn('failed to disable press-and-hold:', err)
        }
      }

      log.main.info(`starting Wanda (serverMode=${SERVER_MODE})`)
      installContentSecurityPolicy()
      ensureGlobalGitignore()

      // Supply Electron-specific config to the (otherwise Electron-free) server
      // services. Must happen before any Effect service resolves.
      configureDatabase({
        dbPath: join(app.getPath('userData'), DB_FILENAME),
        // Migration folder resolution:
        //   1. WANDA_MIGRATIONS_FOLDER env var — used by Playwright E2E to
        //      point at the repo's source migrations without re-packaging.
        //   2. Packaged app → process.resourcesPath/migrations (copied at build).
        //   3. Dev mode → <appPath>/electron/db/migrations (electron-vite sets
        //      appPath to the repo root).
        migrationsFolder: process.env.WANDA_MIGRATIONS_FOLDER
          ? process.env.WANDA_MIGRATIONS_FOLDER
          : app.isPackaged
            ? join(process.resourcesPath, 'migrations')
            : join(app.getAppPath(), 'electron/db/migrations'),
      })
      const mcpServerPath = app.isPackaged
        ? join(process.resourcesPath, 'mcp/index.js')
        : join(app.getAppPath(), 'electron/mcp/dist/index.js')
      process.env.WANDA_MCP_SERVER_PATH = mcpServerPath

      configureAgentRuntime({
        appRoot: app.getAppPath(),
        mcpServerPath,
        appVersion: app.getVersion(),
        openExternal: (url: string) => {
          shell.openExternal(url).catch((err) => {
            log.main.warn('shell.openExternal failed', { url, err })
          })
        },
      })

      // Install the file-based AES secret store for at-rest encryption of
      // remote-target auth tokens. The key lives alongside the sqlite DB
      // in userData with mode 0600. Matches what bin.ts does for subprocess
      // mode — we intentionally don't use Electron safeStorage here because
      // ad-hoc signed builds re-prompt the macOS keychain on every launch.
      const secretKey = loadOrCreateSecretKey(join(app.getPath('userData'), 'secret.key'))
      configureSecretStore(createAesSecretStore(secretKey))

      // Client-local paired-servers registry. Persists in a separate SQLite
      // from the wanda-server DB (this one is scoped to the Electron client,
      // not the server runtime). Session tokens are encrypted via the
      // SecretStore we just configured.
      clientDbRef = createClientDb(join(app.getPath('userData'), 'client.db'))
      serverRegistryRef = createServerRegistry({
        db: clientDbRef,
        clientInfo: {
          deviceName: osHostname(),
          os: process.platform,
          appVersion: app.getVersion(),
        },
      })
      teardownServersIpc = registerServerRegistryIpc(ipcMain, serverRegistryRef)

      // Paired-mutation outbox. Shares the client.db file (both sides use
      // `@wanda/router`'s migration which creates the outbox table). The
      // clientId is the same stable device hostname we use for pairing.
      outboxServiceRef = createOutboxService({
        dbPath: join(app.getPath('userData'), 'client.db'),
        serverRegistry: serverRegistryRef,
        clientId: osHostname(),
      })
      teardownOutboxIpc = registerOutboxIpc(ipcMain, outboxServiceRef)

      // Opportunistic boot-time drain: if the user queued mutations in a
      // previous session that never reached their paired server, retry them
      // now against whatever paired servers are reachable. Per-registry
      // failures stop that registry's drain but don't affect others.
      {
        const outbox = outboxServiceRef
        const registries = new Set<string>()
        for (const entry of outbox.listPending()) registries.add(entry.registryId)
        for (const registryId of registries) {
          outbox.drainForRegistry(registryId).catch((err) => {
            log.main.warn('outbox boot drain failed', { registryId, err })
          })
        }
      }

      // ---------------------------------------------------------------------------
      // Bring up the server runtime. Must complete before creating the window
      // because the preload needs the URL + token via additionalArguments.
      // ---------------------------------------------------------------------------
      serverHandle = await bootServer()

      // ---------------------------------------------------------------------------
      // Create the main window. The preload connects over WS using the
      // additionalArguments we just derived from `serverHandle.connection`.
      // ---------------------------------------------------------------------------
      const firstWindow = createWindow()
      setupWindow(firstWindow)
      await new Promise<void>((resolve) => {
        firstWindow.once('ready-to-show', () => {
          if (process.env.WANDA_HEADLESS !== '1') {
            firstWindow.show()
          }
          resolve()
        })
      })

      // ---------------------------------------------------------------------------
      // Wire the handful of IPC handlers Electron still needs.
      // All RPC + streaming goes over WS — the handlers below are for things
      // only the Electron shell can do (native dialogs, tray, open external).
      // ---------------------------------------------------------------------------

      // Local-server info for the Machines page. Returns listen address + a
      // fresh one-shot pairing URL. Subprocess mode returns null since the
      // AuthStore lives inside the child and isn't reachable from here.
      ipcMain.handle('local-server:info', () => {
        if (!localServerRef) return null
        const hosts = localServerRef.listNetworkHosts()
        return {
          listenHost: localServerRef.listenHost,
          port: localServerRef.port,
          serverId: localServerRef.serverId,
          hostname: localServerRef.hostname,
          networkHosts: hosts,
          exposed: localServerRef.listenHost !== '127.0.0.1' && localServerRef.listenHost !== 'localhost',
        }
      })
      ipcMain.handle('local-server:issue-pairing-url', () => {
        if (!localServerRef) return null
        const { url, expiresAt } = localServerRef.issuePairingUrl()
        return { url, expiresAt }
      })
      ipcMain.handle('local-server:incoming-sessions', () => {
        if (!localServerRef) return []
        return localServerRef.listIncomingSessions()
      })
      ipcMain.handle('local-server:revoke-incoming-session', (_, sessionId: string) => {
        if (!localServerRef) return false
        return localServerRef.revokeIncomingSession(sessionId)
      })

      // Open external URLs from the renderer (xterm link clicks, toasts, etc.).
      ipcMain.on('shell:openExternal', (event, url: string) => {
        try {
          const sourceWindow = BrowserWindow.fromWebContents(event.sender)
          const internalRoute = sourceWindow ? getInternalRendererRoute(url, sourceWindow.webContents.getURL()) : null
          if (internalRoute) {
            sourceWindow?.webContents.send('app:navigate', internalRoute)
            return
          }

          const parsed = new URL(url)
          if (['http:', 'https:'].includes(parsed.protocol)) {
            shell.openExternal(url).catch((err) => {
              log.main.warn('shell.openExternal failed', { url, err })
            })
          }
        } catch (err) {
          log.main.error(`shell:openExternal invalid URL`, { url, err })
        }
      })

      // ---------------------------------------------------------------------------
      // Tray / menubar
      // ---------------------------------------------------------------------------
      const trayManager = new TrayManager(join(__dirname, '../preload/preload.mjs'), buildPreloadArgs())
      trayManager.init()
      trayManagerRef = trayManager

      // Tray navigation — show+focus main window and navigate to the requested route.
      ipcMain.on('tray:navigate', (_, route: string, opts?: { focusPodId?: string; focusAgentId?: string }) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          const win = createWindow()
          setupWindow(win)
        }
        mainWindow?.show()
        mainWindow?.focus()
        mainWindow?.webContents.send('app:navigate', route, opts)
        trayManager.hide()
      })

      // Tray → renderer cache-invalidate: the tray receives server events via
      // its own WS connection, so this is mostly just a hint for edge cases.
      ipcMain.on('tray:invalidate', (_, _namespace: string, _method: string) => {
        // No-op in WS mode — both windows already received the invalidate
        // event through the server's gateway broadcast. Kept as an endpoint
        // so existing tray callers don't crash; can be removed when the
        // tray UI code stops calling it.
      })

      // Attention mode — show+focus the main window when a request needs handling.
      // Records whether we had to un-hide it so we can restore the hidden state later.
      ipcMain.on('app:attention-present', () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          attentionHidMainWindow = true
          const win = createWindow()
          setupWindow(win)
          mainWindow?.show()
          mainWindow?.focus()
          return
        }
        const wasHidden = !mainWindow.isVisible() || mainWindow.isMinimized()
        if (wasHidden) attentionHidMainWindow = true
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      })

      // Attention mode — hide the main window again once the queue drains, but only
      // if attention mode itself was what made it visible in the first place.
      ipcMain.on('app:attention-dismiss', () => {
        if (!attentionHidMainWindow) return
        attentionHidMainWindow = false
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
      })

      // Initial cache + badge refresh.
      refreshCloseToTrayCache()
      void updateDockBadge()
      void serverHandle.connectAndRecover()

      // The renderer-side reconnection code listens for `shell:reconnect`
      // to force a full TanStack Query refetch after subprocess restarts.
      // We also refresh local caches on the main side.
      ipcMain.on('shell:notifications-refresh', () => {
        refreshCloseToTrayCache()
        void updateDockBadge()
      })
    })
    .catch((err) => {
      // A boot failure (e.g. the TLS-guard rejecting a non-loopback bind
      // without WANDA_INSECURE_LAN) used to surface as an unhandled promise
      // rejection and leave the app running with no server — every
      // subsequent RPC then 401'd against a half-initialised auth store.
      // Fail loudly and exit so the operator sees the real error.
      log.main.error('fatal: server bootstrap failed:', err)
      process.exitCode = 1
      app.quit()
    })
}

// -----------------------------------------------------------------------------
// Shutdown + Electron lifecycle
// -----------------------------------------------------------------------------

let shuttingDown = false

app.on('before-quit', (event) => {
  quitting = true
  if (shuttingDown) return
  if (!serverHandle) return
  event.preventDefault()
  shuttingDown = true

  trayManagerRef?.destroy()
  teardownOutboxIpc?.()
  teardownOutboxIpc = null
  teardownServersIpc?.()
  teardownServersIpc = null
  try {
    outboxServiceRef?.close()
  } catch (err) {
    log.main.warn('outbox service close failed:', err)
  }
  outboxServiceRef = null
  try {
    clientDbRef?.close()
  } catch (err) {
    log.main.warn('client db close failed:', err)
  }
  clientDbRef = null
  serverRegistryRef = null
  serverHandle
    .stop()
    .catch((err) => log.main.error('server runtime stop failed:', err))
    .finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
  } else if (BrowserWindow.getAllWindows().length === 0) {
    const win = createWindow()
    setupWindow(win)
  }
})
