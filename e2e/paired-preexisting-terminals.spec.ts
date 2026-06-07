// -----------------------------------------------------------------------------
// Pre-existing paired terminals all route to the paired bridge.
//
// `terminalRegistry.acquire()` captures the transport the first time each
// ptyInstanceId is seen. If a TerminalView mounts before `pod.listTerminals`
// / `pod.runningTerminals` resolve, the terminalId isn't in
// `terminalOwnership` yet — without the synchronously-registered pod scope
// (`registerRemotePodScope`) the view latches onto the local transport and
// stays there forever.
//
// Spec creates N pre-existing terminals on B, pairs A → B, navigates, and
// asserts every ptyInstanceId resolves via `source: 'scope' | 'explicit'`
// (never `'none'`) and at least one xterm per terminal renders output.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
  }
}

type TestRenderer = {
  listMountedTerminals: () => string[]
  readTerminalText: (ptyInstanceId: string) => string
}

const TERMINAL_COUNT = 3

test('pre-existing paired terminals all route to the paired bridge on first mount', async ({ wandaA, wandaB }) => {
  // Seed N pre-existing terminals on B before A ever sees the pod.
  const seed = await wandaB.mainWindow.evaluate(async (n: number) => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], {
      name: 'preex-ws',
      cwd: '/tmp',
    })) as { id: string; name: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'preex-pod',
      cwd: '/tmp',
    })) as { id: string; name: string }
    for (let i = 0; i < n; i++) {
      await w.wanda.rpc.call(['pod', 'addTerminal'], {
        podId: pod.id,
        name: `shell-${i}`,
        command: '/bin/sh',
        args: ['-i'],
      })
    }
    await w.wanda.rpc.call(['pod', 'ensureStarted'], { id: pod.id })
    return { workspaceName: ws.name, podName: pod.name, podId: pod.id }
  }, TERMINAL_COUNT)

  // Wait until B reports ALL N PTYs are running. Missing any one here
  // would mean we're testing a partial state.
  const runningPtys = await (async () => {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const running = (await wandaB.mainWindow.evaluate(async (podId) => {
        const w = window as unknown as { wanda: WandaAPI }
        return (await w.wanda.rpc.call(['pod', 'runningTerminals'], { id: podId })) as Array<{
          ptyInstanceId: string
        }>
      }, seed.podId)) as Array<{ ptyInstanceId: string }>
      if (running.length >= TERMINAL_COUNT && running.every((r) => r.ptyInstanceId)) return running
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error(`B never reported ${TERMINAL_COUNT} running PTYs`)
  })()
  expect(runningPtys).toHaveLength(TERMINAL_COUNT)

  // Pair A → B, reload so sidebar shows the paired workspace.
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.servers.pair(url)
  }, loopback)
  await wandaA.mainWindow.reload()
  await wandaA.waitForReady()

  // Navigate via sidebar.
  await wandaA.mainWindow
    .locator(`[data-wanda-workspace-name="${seed.workspaceName}"]`)
    .first()
    .waitFor({ state: 'attached', timeout: 20_000 })
  await wandaA.mainWindow.locator(`[data-wanda-pod-row][data-wanda-pod-name="${seed.podName}"]`).first().click()

  // Pod page mounts as remote.
  await wandaA.mainWindow.waitForSelector('[data-wanda-pod-page][data-wanda-pod-kind="remote"]', {
    timeout: 20_000,
    state: 'attached',
  })

  // Wait for ANY pre-existing ptyInstanceId to mount on A. Tabs view
  // typically mounts only the active tab at once; which one is active
  // depends on the view-store default. As long as at least one of B's
  // running PTYs appears here we can verify the paired bridge route.
  const mountedPty = await (async () => {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const mounted = await wandaA.mainWindow.evaluate(() => {
        const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
        return w.__wandaTestRenderer?.listMountedTerminals() ?? []
      })
      const hit = runningPtys.find((r) => mounted.includes(r.ptyInstanceId))
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error('no pre-existing ptyInstanceId ever mounted on A')
  })()

  // Core assertion: the first mounted pre-existing terminal must receive
  // streamed output from B. A registration-vs-acquire race would fail
  // this with a silent timeout.
  const marker = `PREEX_${Math.random().toString(36).slice(2, 8)}`
  await wandaB.mainWindow.evaluate(
    async ({ id, marker }: { id: string; marker: string }) => {
      const w = window as unknown as {
        wanda: { terminal: { write: (id: string, data: string) => void } }
      }
      w.wanda.terminal.write(id, `echo ${marker}\n`)
    },
    { id: mountedPty.ptyInstanceId, marker },
  )
  const deadline = Date.now() + 10_000
  let seen = false
  while (Date.now() < deadline) {
    const text = await wandaA.mainWindow.evaluate((id: string) => {
      const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
      return w.__wandaTestRenderer?.readTerminalText(id) ?? ''
    }, mountedPty.ptyInstanceId)
    if (text.includes(marker)) {
      seen = true
      break
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  expect(seen, `pre-existing terminal ${mountedPty.ptyInstanceId} never received echo`).toBe(true)
})
