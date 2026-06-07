// -----------------------------------------------------------------------------
// Paired-pod renders end-to-end.
//
// `ui-bidirectional-terminal.spec.ts` proves bytes flow, but it doesn't
// assert the pod view region renders — only that xterm textareas exist.
// This spec demands every visible layer mount:
//
//   1. Paired RPC queries return data (pod.getById, pod.listTerminals,
//      podItem.list, view.listByPod)
//   2. The renderer's view-store sees the paired pod's views loaded
//   3. At least one xterm is mounted
//   4. DOM contains the pod's ContentTopBar + an ActiveViewRenderer subtree
//
// Any silent failure in the paired-pod data pipeline surfaces here.
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
  getViewStoreSnapshot: (entityId: string) => Promise<{
    activeViewId: string | null
    podItemIds: string[]
    viewItemSettings: Record<string, string[]>
  } | null>
}

test('paired pod page renders: pod data loads, views mount, xterm attaches', async ({ wandaA, wandaB }) => {
  // ---- B side: seed a workspace with a pod and MULTIPLE terminals. ---------
  // Matches the user's real-world state: pre-existing pods before A pairs.
  const seed = await wandaB.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], {
      name: 'paired-render-ws',
      cwd: '/tmp',
    })) as { id: string; name: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'paired-render-pod',
      cwd: '/tmp',
    })) as { id: string; name: string }
    // Two terminals so we exercise ordering + multiple running PTYs — the
    // single-terminal fast path could mask bugs.
    await w.wanda.rpc.call(['pod', 'addTerminal'], {
      podId: pod.id,
      name: 'shell-a',
      command: '/bin/sh',
      args: ['-i'],
    })
    await w.wanda.rpc.call(['pod', 'addTerminal'], {
      podId: pod.id,
      name: 'shell-b',
      command: '/bin/sh',
      args: ['-i'],
    })
    await w.wanda.rpc.call(['pod', 'ensureStarted'], { id: pod.id })
    return { workspaceName: ws.name, podId: pod.id, podName: pod.name }
  })

  // Wait until B reports both PTYs are running.
  const runningPtys = await (async () => {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const running = (await wandaB.mainWindow.evaluate(async (podId) => {
        const w = window as unknown as { wanda: WandaAPI }
        return (await w.wanda.rpc.call(['pod', 'runningTerminals'], { id: podId })) as Array<{
          ptyInstanceId: string
        }>
      }, seed.podId)) as Array<{ ptyInstanceId: string }>
      if (running.length >= 2 && running.every((r) => r.ptyInstanceId)) return running
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error('B never reported 2 running PTYs')
  })()
  expect(runningPtys).toHaveLength(2)

  // ---- A side: pair into B, reload, navigate via sidebar. -----------------
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.servers.pair(url)
  }, loopback)
  await wandaA.mainWindow.reload()
  await wandaA.waitForReady()

  // B's workspace must appear in A's sidebar before we can click through.
  await wandaA.mainWindow
    .locator(`[data-wanda-workspace-name="${seed.workspaceName}"]`)
    .first()
    .waitFor({ state: 'attached', timeout: 20_000 })
  await wandaA.mainWindow.locator(`[data-wanda-pod-row][data-wanda-pod-name="${seed.podName}"]`).first().click()

  // ---- A side: every visible layer of the paired pod page must render. ---
  //
  // 1. PodPage container must mount with the correct remote kind. A pod
  //    page whose `usePodData` threw would bail at the `!pod` fallback
  //    and render only an empty `<div class="h-full">` — no data
  //    attributes. Finding `[data-wanda-pod-page][data-wanda-pod-kind="remote"]`
  //    means the full render succeeded.
  await wandaA.mainWindow.waitForSelector('[data-wanda-pod-page][data-wanda-pod-kind="remote"]', {
    timeout: 20_000,
    state: 'attached',
  })

  // 2. ContentTopBar must mount — reachable via the data-wanda anchor.
  //    Without a top bar the user sees no status/controls at all.
  await wandaA.mainWindow.waitForSelector('[data-wanda-content-top-bar]', {
    timeout: 15_000,
    state: 'attached',
  })

  // 3. ActiveViewRenderer must mount with a non-fallback view type.
  //    The view-store load effect gates on all three remote queries
  //    (terminalConfigs, podItems, views) reaching 'success'. If any
  //    query is stuck or errored, no activeView is set and this anchor
  //    carries view-type="split-pane" with no items — which is exactly
  //    the "pod view doesn't load" symptom.
  const activeViewEl = wandaA.mainWindow.locator('[data-wanda-active-view]')
  await activeViewEl.waitFor({ state: 'attached', timeout: 15_000 })
  const viewType = await activeViewEl.first().getAttribute('data-wanda-view-type')
  expect(viewType).toBeTruthy()
  expect(viewType).not.toBe('split-pane') // default fallback when nothing loaded

  // 4. At least one xterm must mount on A. This is the single most visible
  //    symptom the user reported ("0 terminals show").
  await wandaA.mainWindow.locator('.xterm-helper-textarea').first().waitFor({
    state: 'attached',
    timeout: 20_000,
  })

  const terminalCount = await wandaA.mainWindow.locator('.xterm').count()
  expect(terminalCount).toBeGreaterThanOrEqual(1)

  // 3. The renderer's view-store must have loaded the pod's views. Without
  //    this, ActiveViewRenderer has no activeView → renders an empty
  //    SplitPaneView with no items. "pod view doesn't load" in user terms.
  //    Note the namespaced podId the route used.
  const namespacedPodId = await wandaA.mainWindow.evaluate((realPodId: string) => {
    // Sidebar drives the route with `remote:<registryId>:<realPodId>`;
    // pull it from the current URL so the assertion matches what the
    // renderer actually mounted.
    const match = window.location.href.match(/\/pods\/([^/?#]+)/)
    return match ? decodeURIComponent(match[1]) : realPodId
  }, seed.podId)
  expect(namespacedPodId.startsWith('remote:')).toBe(true)

  const viewSnapshot = await wandaA.mainWindow.evaluate(async (pid: string) => {
    const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
    return (await w.__wandaTestRenderer?.getViewStoreSnapshot(pid)) ?? null
  }, namespacedPodId)
  expect(viewSnapshot).not.toBeNull()
  expect(viewSnapshot!.activeViewId).not.toBeNull()
  expect(viewSnapshot!.podItemIds.length).toBeGreaterThan(0)

  // 4. At least one of A's mounted terminals must be one of the running
  //    ptyInstanceIds on B (catches "mounted but wrong id" regressions).
  const mounted = await wandaA.mainWindow.evaluate(() => {
    const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
    return w.__wandaTestRenderer?.listMountedTerminals() ?? []
  })
  const match = mounted.some((id) => runningPtys.some((p) => p.ptyInstanceId === id))
  expect(match).toBe(true)
})
