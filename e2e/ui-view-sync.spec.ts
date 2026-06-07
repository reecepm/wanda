// -----------------------------------------------------------------------------
// View-store reconciliation test.
//
// When device B adds an item to a pod the laptop is viewing, A's
// view-store MUST apply the new server-persisted view configs. Before
// the reconcile fix, `load()` was a one-shot and the view-store froze
// at first-mount; TanStack Query's refetch brought fresh data into
// the cache but the view-store ignored it. Symptom on real hardware:
// canvas / split-pane / columns views never show items added by the
// other client.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
    getSessionToken: (id: string) => Promise<string | null>
  }
}

type TestRenderer = {
  getViewStoreSnapshot: (entityId: string) => Promise<{
    activeViewId: string | null
    podItemIds: string[]
    viewItemSettings: Record<string, string[]>
  } | null>
}

type TestHooks = {
  pairedClient: (opts: { baseUrl: string; token: string; path: string[]; input: unknown }) => Promise<unknown>
}

async function pairAIntoB(
  wandaA: { mainWindow: import('@playwright/test').Page; waitForReady: () => Promise<void> },
  wandaB: {
    mintPairingUrl: () => Promise<{ url: string; expiresAt: number } | null>
    localServerInfo: () => Promise<{ port: number; serverId: string } | null>
  },
): Promise<{ id: string; loopbackBaseUrl: string }> {
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  const paired = await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback)
  await wandaA.mainWindow.reload()
  await wandaA.waitForReady()
  return { id: paired.id, loopbackBaseUrl: `http://127.0.0.1:${infoB!.port}` }
}

test('item added by paired client is reconciled into local view-store itemSettings', async ({ wandaA, wandaB }) => {
  // A owns the pod.
  const seed = await wandaA.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], { name: 'view-sync-ws', cwd: '/tmp' })) as {
      id: string
    }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'view-sync-pod',
      cwd: '/tmp',
    })) as { id: string; name: string }
    await w.wanda.rpc.call(['pod', 'addTerminal'], {
      podId: pod.id,
      name: 'seed',
      command: '/bin/sh',
      args: ['-i'],
    })
    return { podId: pod.id, podName: pod.name }
  })

  const paired = await pairAIntoB(wandaB, wandaA)

  // A navigates to its local pod by clicking the sidebar row — this
  // is the only path TanStack Router honors properly for view-store
  // initialization (pushState leaves the router state empty).
  await wandaA.mainWindow.locator(`text=${seed.podName}`).first().click()

  // Wait for view-store to hydrate on A.
  const hydrateDeadline = Date.now() + 15_000
  let initialSnapshot: Awaited<ReturnType<TestRenderer['getViewStoreSnapshot']>> = null
  while (Date.now() < hydrateDeadline) {
    initialSnapshot = await wandaA.mainWindow.evaluate(async (podId) => {
      const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
      return (await w.__wandaTestRenderer?.getViewStoreSnapshot(podId)) ?? null
    }, seed.podId)
    if (initialSnapshot && initialSnapshot.podItemIds.length > 0) break
    await new Promise((r) => setTimeout(r, 200))
  }
  expect(initialSnapshot, 'view-store never hydrated on A').not.toBeNull()
  const initialItemCount = initialSnapshot!.podItemIds.length

  // B adds a new terminal to A's pod via the paired client. This
  // creates a new pod-item on A's server, which broadcasts
  // orpc:invalidate; A's paired invalidation subscribes and refetches
  // the pod-item and view-list queries.
  await wandaB.mainWindow.evaluate(
    async (opts: { baseUrl: string; registryId: string; podId: string }) => {
      const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: TestHooks }
      const token = await w.wanda.servers.getSessionToken(opts.registryId)
      if (!token) throw new Error('no session token')
      await w.__wandaTestHooks.pairedClient({
        baseUrl: opts.baseUrl,
        token,
        path: ['pod', 'addTerminal'],
        input: { podId: opts.podId, name: 'added-by-B', command: '/bin/sh', args: ['-i'] },
      })
    },
    { baseUrl: paired.loopbackBaseUrl, registryId: paired.id, podId: seed.podId },
  )

  // A's view-store must now contain the new pod-item. Without the
  // reconcile-on-refetch fix, `podItemIds` stays at the initial count
  // forever.
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const snap = await wandaA.mainWindow.evaluate(async (podId) => {
      const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
      return (await w.__wandaTestRenderer?.getViewStoreSnapshot(podId)) ?? null
    }, seed.podId)
    if (snap && snap.podItemIds.length > initialItemCount) {
      // Also confirm the new pod-item appears in at least one view's
      // itemSettings (which is what powers per-view rendering).
      const hasInSettings = Object.values(snap.viewItemSettings).some(
        (ids) => ids.length > Object.values(initialSnapshot!.viewItemSettings)[0]?.length,
      )
      expect(hasInSettings, `new item did not reach any view's itemSettings: ${JSON.stringify(snap)}`).toBe(true)
      return
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`A's view-store never observed the item B added within 10s`)
})
