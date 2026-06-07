// -----------------------------------------------------------------------------
// UI-driven bidirectional terminal tests.
//
// Every other terminal e2e drives the paired WS bridge directly via test
// hooks. That proves the data path works in isolation but bypasses the
// renderer — and the renderer is exactly where the user-visible bugs
// have been hiding ("works in tests, blank on real hardware").
//
// These tests drive the actual UI: navigate the sidebar, click the pod
// row, focus the rendered xterm DOM, type via `page.keyboard`, then
// read back the xterm buffer text on BOTH instances. If A types and
// B's xterm doesn't reflect, the failure is in the wiring the user
// actually sees, not in our test plumbing.
// -----------------------------------------------------------------------------

import { test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
  }
}

type TestRenderer = {
  readTerminalText: (ptyInstanceId: string) => string
  listMountedTerminals: () => string[]
}

async function waitForRunningPty(
  ctx: { mainWindow: import('@playwright/test').Page },
  podId: string,
  timeoutMs = 20_000,
): Promise<{ ptyInstanceId: string; podTerminalId: string }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const running = (await ctx.mainWindow.evaluate(async (id) => {
      const w = window as unknown as { wanda: WandaAPI }
      return (await w.wanda.rpc.call(['pod', 'runningTerminals'], { id })) as Array<{
        ptyInstanceId: string
        podTerminalId: string
      }>
    }, podId)) as Array<{ ptyInstanceId: string; podTerminalId: string }>
    if (running[0]?.ptyInstanceId) return running[0]
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`PTY did not spawn for pod ${podId} within ${timeoutMs}ms`)
}

async function waitForTerminalText(
  page: import('@playwright/test').Page,
  ptyInstanceId: string,
  needle: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    last = await page.evaluate((id) => {
      const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
      return w.__wandaTestRenderer?.readTerminalText(id) ?? ''
    }, ptyInstanceId)
    if (last.includes(needle)) return last
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`terminal ${ptyInstanceId} never contained "${needle}" within ${timeoutMs}ms. Last buffer:\n${last}`)
}

async function waitForMountedTerminal(
  page: import('@playwright/test').Page,
  ptyInstanceId: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ids = await page.evaluate(() => {
      const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
      return w.__wandaTestRenderer?.listMountedTerminals() ?? []
    })
    if (ids.includes(ptyInstanceId)) return
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`terminal ${ptyInstanceId} never mounted within ${timeoutMs}ms`)
}

test('A types in a remote terminal and BOTH A and B render the typed output', async ({ wandaA, wandaB }) => {
  // -------------------------------------------------------------------------
  // B owns the pod. Seed + start it.
  // -------------------------------------------------------------------------
  const seed = await wandaB.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], {
      name: 'bidir-ws',
      cwd: '/tmp',
    })) as { id: string; name: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'bidir-pod',
      cwd: '/tmp',
    })) as { id: string; name: string }
    await w.wanda.rpc.call(['pod', 'addTerminal'], {
      podId: pod.id,
      name: 'shell',
      command: '/bin/sh',
      args: ['-i'],
    })
    await w.wanda.rpc.call(['pod', 'ensureStarted'], { id: pod.id })
    return { workspaceName: ws.name, podId: pod.id, podName: pod.name }
  })

  const running = await waitForRunningPty(wandaB, seed.podId)

  // -------------------------------------------------------------------------
  // A pairs into B; reload so the sidebar's useServers picks it up.
  // -------------------------------------------------------------------------
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.servers.pair(url)
  }, loopback)
  await wandaA.mainWindow.reload()
  await wandaA.waitForReady()

  // -------------------------------------------------------------------------
  // Both instances navigate to the pod via UI clicks. B's sidebar shows
  // the pod under the local workspace; A's shows it under B's fanned-out
  // remote workspace. Same locator strategy works for both because the
  // sidebar renders the pod name as text.
  // -------------------------------------------------------------------------
  await wandaA.mainWindow.waitForFunction(
    (name: string) => Array.from(document.querySelectorAll('*')).some((el) => el.textContent === name),
    seed.workspaceName,
    { timeout: 20_000 },
  )

  await wandaA.mainWindow.locator(`text=${seed.podName}`).first().click()
  await wandaB.mainWindow.locator(`text=${seed.podName}`).first().click()

  // Wait for both renderers to mount the xterm for this PTY id. The
  // ptyInstanceId is server-side and shared between A (paired) and B
  // (local) — if either side fails to mount, the wiring is broken.
  await waitForMountedTerminal(wandaA.mainWindow, running.ptyInstanceId)
  await waitForMountedTerminal(wandaB.mainWindow, running.ptyInstanceId)

  // Wait for the xterm helper textarea (the actual focus target inside
  // xterm) to be in the DOM on both sides.
  await wandaA.mainWindow.locator('.xterm-helper-textarea').first().waitFor({ state: 'visible', timeout: 10_000 })
  await wandaB.mainWindow.locator('.xterm-helper-textarea').first().waitFor({ state: 'visible', timeout: 10_000 })

  // -------------------------------------------------------------------------
  // A types → both sides should render the echoed output.
  // -------------------------------------------------------------------------
  const markerA = `WANDA_A_${Math.random().toString(36).slice(2, 8)}`
  await wandaA.mainWindow.locator('.xterm-helper-textarea').first().focus()
  await wandaA.mainWindow.keyboard.type(`echo ${markerA}\n`)

  await waitForTerminalText(wandaA.mainWindow, running.ptyInstanceId, markerA)
  await waitForTerminalText(wandaB.mainWindow, running.ptyInstanceId, markerA)

  // -------------------------------------------------------------------------
  // B types → both sides should render. This is the inverse direction.
  // -------------------------------------------------------------------------
  const markerB = `WANDA_B_${Math.random().toString(36).slice(2, 8)}`
  await wandaB.mainWindow.locator('.xterm-helper-textarea').first().focus()
  await wandaB.mainWindow.keyboard.type(`echo ${markerB}\n`)

  await waitForTerminalText(wandaA.mainWindow, running.ptyInstanceId, markerB)
  await waitForTerminalText(wandaB.mainWindow, running.ptyInstanceId, markerB)
})
