// -----------------------------------------------------------------------------
// Browser entry for Wanda.
//
// Installs `window.wanda` via the pure-browser WS transport from
// electron/preload/ws-transport.ts (no Electron imports), then dynamically
// imports the normal `main.tsx` to start the React tree. The renderer code
// doesn't know the difference between this path and the Electron preload
// path — `window.wanda` has the same shape in both cases, and renderer
// features use `window.wanda.env.*` to branch on environment capabilities
// when needed.
//
// Config discovery (in priority order):
//   1. URL query string: ?server=http://HOST:PORT&token=HEX
//   2. sessionStorage (survives page reloads within the tab)
//   3. Inline login form (if no config is present)
//
// A prettier login flow + proper auth exchange is follow-up work.
// -----------------------------------------------------------------------------

import { createWandaApi, type WandaAPI } from '../electron/preload/api'
import { createWsTransport } from '../electron/preload/ws-transport'
import { buildConfig, CONFIG_STORAGE_KEY, parseStoredConfig, readConfigFromUrl, type WebConfig } from './web-config'

function readConfig(): WebConfig | null {
  // 1. URL query string wins (fresh install / new tab with shared link).
  const urlConfig = readConfigFromUrl(window.location.href)
  if (urlConfig) {
    sessionStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(urlConfig))
    // Clean the URL so the token isn't visible in history / bookmarks.
    window.history.replaceState({}, '', window.location.pathname)
    return urlConfig
  }

  // 2. Persisted from a previous load this session.
  const stored = parseStoredConfig(sessionStorage.getItem(CONFIG_STORAGE_KEY))
  if (stored) return stored
  // Clear out any malformed stored value.
  sessionStorage.removeItem(CONFIG_STORAGE_KEY)
  return null
}

function showLoginForm(): Promise<WebConfig> {
  return new Promise((resolve) => {
    const splash = document.getElementById('splash')
    if (splash) splash.remove()

    const container = document.createElement('div')
    container.id = 'login-form'
    container.innerHTML = `
      <div style="font-size: 18px; font-weight: 600;">Connect to Wanda server</div>
      <input id="server-input" type="text" placeholder="http://127.0.0.1:9191" value="http://127.0.0.1:9191" />
      <input id="token-input" type="password" placeholder="Bearer token (see server startup log)" />
      <button type="button" id="connect-btn">Connect</button>
      <div class="hint">
        Start the server with <code style="background:#18181b;padding:2px 6px;border-radius:4px;">bun run server:start</code>
        and paste the token from the startup log. Or append
        <code style="background:#18181b;padding:2px 6px;border-radius:4px;">?server=URL&token=TOKEN</code>
        to the page URL.
      </div>
    `
    document.body.appendChild(container)

    const serverInput = container.querySelector<HTMLInputElement>('#server-input')!
    const tokenInput = container.querySelector<HTMLInputElement>('#token-input')!
    const connectBtn = container.querySelector<HTMLButtonElement>('#connect-btn')!

    const submit = () => {
      const serverUrl = serverInput.value.trim()
      const token = tokenInput.value.trim()
      if (!serverUrl || !token) return
      const config = buildConfig(serverUrl, token)
      sessionStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config))
      container.remove()
      resolve(config)
    }

    connectBtn.addEventListener('click', submit)
    tokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit()
    })
    tokenInput.focus()
  })
}

async function bootstrap(): Promise<void> {
  let config = readConfig()
  if (!config) {
    config = await showLoginForm()
  }

  const transport = createWsTransport({
    httpUrl: config.httpUrl,
    wsUrl: config.wsUrl,
    sessionToken: config.token,
    platform: 'browser',
  })

  // Wait for the event WebSocket to connect before installing window.wanda.
  // This avoids a race where renderer code fires an RPC before the auth
  // upgrade completes.
  await transport.waitForReady()

  const api = createWandaApi(transport) satisfies WandaAPI
  window.wanda = api

  // Dynamically import the real entry. At this point window.wanda is live.
  await import('./main')
}

bootstrap().catch((err) => {
  console.error('[wanda web-entry] fatal startup error', err)
  const splash = document.getElementById('splash')
  if (splash) splash.remove()
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = `
      <div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:oklch(0.17 0.004 260);color:#e4e4e7;font-family:system-ui;gap:12px;padding:32px;">
        <div style="font-size:14px;font-weight:500;">Wanda failed to start.</div>
        <pre style="max-width:560px;overflow:auto;border:1px solid #27272a;background:rgba(24,24,27,0.6);padding:12px;font-size:10px;color:#fca5a5;">${String((err as Error)?.message ?? err)}</pre>
        <button type="button" onclick="sessionStorage.removeItem('${CONFIG_STORAGE_KEY}'); location.reload()" style="background:#3b82f6;color:white;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">Reset config and reload</button>
      </div>
    `
  }
})
