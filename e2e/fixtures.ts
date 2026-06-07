// -----------------------------------------------------------------------------
// Playwright fixtures for Wanda Electron E2E.
//
// Each test that needs a live Wanda instance destructures `wanda` (or
// `wandaA` / `wandaB` for the pairing suite). The fixture boots a real
// packaged `out/main/main.js`, isolates its userData + listen port per
// instance, waits for the renderer to finish hydrating, and exposes the
// main BrowserWindow as a Playwright `Page` plus a couple of convenience
// helpers on top.
// -----------------------------------------------------------------------------

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as base, type ElectronApplication, _electron as electron, type Page } from '@playwright/test'

const DIRNAME = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(DIRNAME, '..')
const MAIN_ENTRY = join(REPO_ROOT, 'out/main/main.js')

export interface LaunchWandaOpts {
  /**
   * WANDA_LISTEN_HOST value. `0.0.0.0` to bind publicly (needed for
   * cross-instance pairing); `127.0.0.1` for a purely local boot.
   */
  listenHost?: string
  /** Extra env vars — merged over the defaults. */
  env?: Record<string, string | undefined>
  /** Optional label for logs. */
  label?: string
  /**
   * Reuse an existing userDataDir rather than creating a fresh one. Used
   * by cold-restart tests that want the main process to load the
   * previous run's SQLite (paired sessions, preferences, etc.). When
   * set, the test owns the directory lifetime — the returned
   * `dispose()` will NOT delete it.
   */
  reuseUserDataDir?: string
}

export interface WandaInstance {
  app: ElectronApplication
  mainWindow: Page
  userDataDir: string
  label: string
  /** Navigate the renderer's TanStack Router to a given path. */
  goto(path: string): Promise<void>
  /**
   * Wait for the initial preload boot + splash to finish. Returns once the
   * router has painted at least one pod-list / machines / settings route.
   */
  waitForReady(): Promise<void>
  /** Read the in-renderer `window.wanda.localServer.info()` handle. */
  localServerInfo(): Promise<{
    listenHost: string
    port: number
    serverId: string
    hostname: string
    networkHosts: string[]
    exposed: boolean
  } | null>
  /** Mint a pairing URL by calling the preload API directly. */
  mintPairingUrl(): Promise<{ url: string; expiresAt: number } | null>
  /** List paired servers via the preload API. */
  listPairedServers(): Promise<Array<{ id: string; serverId: string; label: string; baseUrl: string }>>
  dispose(): Promise<void>
}

export async function launchWanda(opts: LaunchWandaOpts = {}): Promise<WandaInstance> {
  const label = opts.label ?? 'wanda'
  const reuse = opts.reuseUserDataDir
  const userDataDir = reuse ?? mkdtempSync(join(tmpdir(), `wanda-e2e-${label}-`))
  const ownsDir = reuse === undefined

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      // Force the embedded-server runtime (the one the E2E needs).
      WANDA_SERVER_MODE: 'embedded',
      // Bind to loopback by default. The pairing suite overrides to 0.0.0.0.
      WANDA_LISTEN_HOST: opts.listenHost ?? '127.0.0.1',
      // The production build refuses non-loopback binds without explicit
      // operator acknowledgement. Tests that bind to 0.0.0.0 need the
      // escape hatch set for the child process — ambient process env
      // from the Playwright runner is irrelevant here.
      WANDA_INSECURE_LAN: '1',
      // Override the path getter that main.ts reads BEFORE whenReady.
      WANDA_USER_DATA_DIR: userDataDir,
      // Force-skip onboarding autolaunch side effects in tests.
      ELECTRON_ENABLE_LOGGING: '1',
      // Point at the repo's source migrations — the compiled main.js has
      // no idea where the .sql files live otherwise.
      WANDA_MIGRATIONS_FOLDER: join(REPO_ROOT, 'electron/db/migrations'),
      // Expose `window.__wandaTestHooks` with a `pairedClient()` helper for
      // the pairing E2E — lets us drive RPC calls against arbitrary paired
      // servers from inside `page.evaluate()` without wrangling bundler
      // dynamic imports.
      WANDA_E2E_EXPOSE_TEST_HELPERS: '1',
      // Skip the welcome / onboarding flow so the main app mounts
      // immediately. Without this the renderer renders the onboarding
      // shell and `window.wanda.app.waitForServicesReady()` never
      // resolves against the main route tree.
      WANDA_SKIP_ONBOARDING: '1',
      // Run without showing the BrowserWindow when the parent process
      // requests it (CI, or local dev that doesn't want focus theft).
      // When unset, the window shows as normal so manual debugging
      // works. main.ts gates its .show() call on this same env.
      ...(process.env.WANDA_HEADLESS ? { WANDA_HEADLESS: process.env.WANDA_HEADLESS } : {}),
      ...(opts.env ?? {}),
    } as Record<string, string>,
    timeout: 60_000,
  })

  // Mirror child process stderr/stdout so Playwright logs surface boot errors.
  app.process().stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[${label} stderr] ${chunk.toString()}`)
  })
  app.process().stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[${label} stdout] ${chunk.toString()}`)
  })

  const mainWindow = await app.firstWindow({ timeout: 60_000 })
  await mainWindow.waitForLoadState('domcontentloaded')

  async function waitForReady(): Promise<void> {
    // waitForReady resolves when window.wanda exposes the API (preload ran)
    // AND the initial routerq hydration has attached. A 30s outer cap
    // keeps the failure mode actionable.
    await mainWindow.waitForFunction(
      () => {
        const w = window as unknown as { wanda?: unknown }
        return typeof w.wanda !== 'undefined'
      },
      undefined,
      { timeout: 30_000 },
    )
    await mainWindow.evaluate(async () => {
      type WandaAPI = {
        app: { waitForServicesReady: () => Promise<void> }
      }
      const w = window as unknown as { wanda: WandaAPI }
      await w.wanda.app.waitForServicesReady()
    })
  }

  async function goto(path: string): Promise<void> {
    await mainWindow.evaluate((p) => {
      const link = document.createElement('a')
      link.href = p
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    }, path)
  }

  return {
    app,
    mainWindow,
    userDataDir,
    label,
    waitForReady,
    goto,
    async localServerInfo() {
      return await mainWindow.evaluate(async () => {
        type WandaAPI = {
          localServer: { info: () => Promise<unknown> }
        }
        const w = window as unknown as { wanda: WandaAPI }
        return (await w.wanda.localServer.info()) as {
          listenHost: string
          port: number
          serverId: string
          hostname: string
          networkHosts: string[]
          exposed: boolean
        } | null
      })
    },
    async mintPairingUrl() {
      return await mainWindow.evaluate(async () => {
        type WandaAPI = {
          localServer: { issuePairingUrl: () => Promise<unknown> }
        }
        const w = window as unknown as { wanda: WandaAPI }
        return (await w.wanda.localServer.issuePairingUrl()) as { url: string; expiresAt: number } | null
      })
    },
    async listPairedServers() {
      return await mainWindow.evaluate(async () => {
        type WandaAPI = {
          servers: { list: () => Promise<unknown> }
        }
        const w = window as unknown as { wanda: WandaAPI }
        return (await w.wanda.servers.list()) as Array<{
          id: string
          serverId: string
          label: string
          baseUrl: string
        }>
      })
    },
    async dispose() {
      try {
        await app.close()
      } catch {
        // ignore close-time errors; we're cleaning up
      }
      if (ownsDir) {
        try {
          rmSync(userDataDir, { recursive: true, force: true })
        } catch {
          // ignore
        }
      }
    },
  }
}

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

interface TwoWandas {
  wandaA: WandaInstance
  wandaB: WandaInstance
}

export const test = base.extend<
  {
    wanda: WandaInstance
    wandaFake: WandaInstance
  } & TwoWandas
>({
  wanda: async (_, use) => {
    const instance = await launchWanda({ label: 'solo' })
    await instance.waitForReady()
    await use(instance)
    await instance.dispose()
  },
  // Workenv e2e: runs the server with the FakeRuntimeAdapter swapped in
  // for OrbStack/Colima so create/start/stop/destroy don't require a real
  // VM. The adapter is programmable from within a single process, so tests
  // can assert on calls via RPC-observable state (events, resolvedPorts).
  wandaFake: async (_, use) => {
    const instance = await launchWanda({ label: 'fake', env: { WANDA_FAKE_RUNTIME: '1' } })
    await instance.waitForReady()
    await use(instance)
    await instance.dispose()
  },
  wandaA: async (_, use) => {
    // Force ephemeral ports for the shared fixture so two instances
    // running side-by-side never collide on the default stable port
    // (9876). Explicit port-heal tests launch their own instances with
    // specific ports via `launchWanda` directly.
    const instance = await launchWanda({ label: 'A', listenHost: '0.0.0.0', env: { WANDA_PORT: '0' } })
    await instance.waitForReady()
    await use(instance)
    await instance.dispose()
  },
  wandaB: async (_, use) => {
    const instance = await launchWanda({ label: 'B', listenHost: '0.0.0.0', env: { WANDA_PORT: '0' } })
    await instance.waitForReady()
    await use(instance)
    await instance.dispose()
  },
})

export { expect } from '@playwright/test'
