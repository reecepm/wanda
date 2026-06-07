// -----------------------------------------------------------------------------
// Cold-restart paired invalidation test.
//
// Every other test in this suite pairs and then tests inside the same
// Electron process lifetime. That means the main-process ServerRegistry
// already has the paired entry in memory, TanStack Query caches are
// warm, bridges open cleanly, etc. It does NOT exercise the path a real
// user hits every time they start the app: session loaded from SQLite,
// bridges built from scratch, renderer hydrating with caches empty.
//
// Cold-restart is where real-world reports of "nothing syncs" keep
// surfacing. If paired invalidation breaks on cold start, this is the
// test that catches it. Launch two instances, pair, close BOTH
// processes, relaunch both with the same userDataDirs, then prove that
// a mutation on B shows up on A's sidebar without a reload.
// -----------------------------------------------------------------------------

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchWanda, type WandaInstance } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
    list: () => Promise<Array<{ id: string; serverId: string; baseUrl: string }>>
  }
}

async function pairAIntoB(a: WandaInstance, b: WandaInstance): Promise<void> {
  const pairingUrl = await b.mintPairingUrl()
  const infoB = await b.localServerInfo()
  if (!pairingUrl || !infoB) throw new Error('could not prepare pairing')
  const loopback = pairingUrl.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB.port}`)
  await a.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.servers.pair(url)
  }, loopback)
  await a.mainWindow.reload()
  await a.waitForReady()
}

async function waitForDomText(
  page: import('@playwright/test').Page,
  needle: string,
  timeoutMs = 15_000,
): Promise<void> {
  await page.waitForFunction(
    (txt: string) => Array.from(document.querySelectorAll('*')).some((el) => el.textContent === txt),
    needle,
    { timeout: timeoutMs },
  )
}

test('paired invalidation works after both sides cold-restart with session restored from disk', async () => {
  // We own the userDataDirs for both sides so we can relaunch against
  // the same SQLite state a real user would see on app boot.
  const aDir = mkdtempSync(join(tmpdir(), 'wanda-cold-A-'))
  const bDir = mkdtempSync(join(tmpdir(), 'wanda-cold-B-'))

  // B needs a stable port so the paired entry stored on A survives a
  // full restart — the port is part of the stored baseUrl and our
  // ephemeral ports change on every launch.
  const B_PORT = '19876'

  // ---------------------------------------------------------------------------
  // Phase 1 — fresh launch, pair, seed.
  // ---------------------------------------------------------------------------
  let a: WandaInstance | null = null
  let b: WandaInstance | null = null
  try {
    b = await launchWanda({
      label: 'B-cold1',
      listenHost: '0.0.0.0',
      reuseUserDataDir: bDir,
      env: { WANDA_PORT: B_PORT },
    })
    a = await launchWanda({ label: 'A-cold1', listenHost: '0.0.0.0', reuseUserDataDir: aDir, env: { WANDA_PORT: '0' } })
    await Promise.all([a.waitForReady(), b.waitForReady()])

    const wsName = `cold-ws-${Math.random().toString(36).slice(2, 6)}`
    await b.mainWindow.evaluate(async (name) => {
      const w = window as unknown as { wanda: WandaAPI }
      await w.wanda.rpc.call(['workspace', 'create'], { name, cwd: '/tmp' })
    }, wsName)

    await pairAIntoB(a, b)
    await waitForDomText(a.mainWindow, wsName, 20_000)

    // Sanity: paired entries persisted on A.
    const persisted = await a.listPairedServers()
    expect(persisted.length).toBeGreaterThanOrEqual(1)
    expect(persisted[0].baseUrl).toContain(`:${B_PORT}`)

    // Expose wsName to phase 3 via a closure variable captured below.
    ;(globalThis as any).__coldTestWsName = wsName
  } finally {
    // Tear down BOTH Electron processes fully. This is critical — we
    // must release their SQLite locks and free port B_PORT before the
    // relaunch below tries to bind the same port.
    await a?.app.close().catch(() => {})
    await b?.app.close().catch(() => {})
  }

  // Let the OS release the port + file locks. macOS is usually
  // instant but give it a moment to avoid a racy EADDRINUSE.
  await new Promise((r) => setTimeout(r, 1_000))

  // ---------------------------------------------------------------------------
  // Phase 2 — cold restart. Same userDataDirs. Same B port. Paired
  // entry on A's side is loaded fresh from SQLite. Bridges open from
  // scratch. This mirrors the real-world boot.
  // ---------------------------------------------------------------------------
  let a2: WandaInstance | null = null
  let b2: WandaInstance | null = null
  try {
    b2 = await launchWanda({
      label: 'B-cold2',
      listenHost: '0.0.0.0',
      reuseUserDataDir: bDir,
      env: { WANDA_PORT: B_PORT },
    })
    a2 = await launchWanda({
      label: 'A-cold2',
      listenHost: '0.0.0.0',
      reuseUserDataDir: aDir,
      env: { WANDA_PORT: '0' },
    })
    await Promise.all([a2.waitForReady(), b2.waitForReady()])

    // Verify pairing survived.
    const restored = await a2.listPairedServers()
    expect(restored.length).toBeGreaterThanOrEqual(1)

    // The workspace we created pre-restart should still render on A2
    // (it was fetched via fan-out when A2's sidebar mounted).
    const wsName = (globalThis as any).__coldTestWsName as string
    await waitForDomText(a2.mainWindow, wsName, 20_000)

    // ---- THE real assertion. B2 creates a new pod; A2's sidebar must
    // reflect it within a reasonable window, driven entirely by the
    // paired invalidation WS (no reload, no polling shortcut).
    const podName = `cold-pod-${Math.random().toString(36).slice(2, 6)}`
    await b2.mainWindow.evaluate(
      async (opts: { wsName: string; podName: string }) => {
        const w = window as unknown as { wanda: WandaAPI }
        const wsList = (await w.wanda.rpc.call(['workspace', 'list'], {})) as Array<{ id: string; name: string }>
        const ws = wsList.find((x) => x.name === opts.wsName)
        if (!ws) throw new Error('workspace missing on B after cold restart')
        await w.wanda.rpc.call(['pod', 'create'], { workspaceId: ws.id, name: opts.podName, cwd: '/tmp' })
      },
      { wsName, podName },
    )

    await waitForDomText(a2.mainWindow, podName, 15_000)
  } finally {
    await a2?.app.close().catch(() => {})
    await b2?.app.close().catch(() => {})
    try {
      rmSync(aDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    try {
      rmSync(bDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})
