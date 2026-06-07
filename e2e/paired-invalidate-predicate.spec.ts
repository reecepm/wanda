// -----------------------------------------------------------------------------
// Paired-server cache-invalidation predicate.
//
// When B mutates a resource, B broadcasts `orpc:invalidate`; A's paired
// bridge forwards it into A's `usePairedInvalidation` hook, which walks
// `queryClient` and invalidates every query whose key is scoped to the
// paired server. If the predicate's key-shape check drifts from the
// actual key shape `use-pod-data.ts` emits (`['remote', registryId,
// 'pod.listTerminals', realPodId]` etc.), the invalidation silently no-
// ops — stale data stays on screen.
//
// This spec seeds a paired pod with zero terminals, mounts the pod page
// on A, then B adds a terminal. A's `pod.listTerminals` query must
// refetch and surface the new terminal. Guards the predicate at
// `use-paired-invalidation.ts:42`.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
  }
}

type CacheEntry = {
  queryKey: readonly unknown[]
  state: { status: string; dataUpdateCount: number; fetchStatus: string }
}

type TestRenderer = {
  getPairedQueryCacheEntries: (registryId: string) => CacheEntry[]
}

test('B mutation invalidates A pod.listTerminals via paired bridge', async ({ wandaA, wandaB }) => {
  // Seed a paired pod on B — NO terminals yet.
  const seed = await wandaB.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], {
      name: 'invalidate-ws',
      cwd: '/tmp',
    })) as { id: string; name: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'invalidate-pod',
      cwd: '/tmp',
    })) as { id: string; name: string }
    return { workspaceName: ws.name, podName: pod.name, podId: pod.id }
  })

  // Pair A → B, reload so the sidebar reflects the new paired server.
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  const paired = await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback)
  const registryId = paired.id
  await wandaA.mainWindow.reload()
  await wandaA.waitForReady()

  // Navigate A to the paired pod via sidebar click.
  await wandaA.mainWindow
    .locator(`[data-wanda-workspace-name="${seed.workspaceName}"]`)
    .first()
    .waitFor({ state: 'attached', timeout: 20_000 })
  await wandaA.mainWindow.locator(`[data-wanda-pod-row][data-wanda-pod-name="${seed.podName}"]`).first().click()

  // Wait for the pod page to mount as remote.
  await wandaA.mainWindow.waitForSelector('[data-wanda-pod-page][data-wanda-pod-kind="remote"]', {
    timeout: 20_000,
    state: 'attached',
  })

  // Snapshot A's paired pod.listTerminals cache entry. `use-pod-data`
  // keyed it as `['remote', registryId, 'pod.listTerminals', realPodId]`
  // the moment the pod page mounted and its first query resolved.
  const findListTerminals = (entries: CacheEntry[], realPodId: string) =>
    entries.find((e) => e.queryKey.length >= 4 && e.queryKey[2] === 'pod.listTerminals' && e.queryKey[3] === realPodId)

  const before = await wandaA.mainWindow.evaluate(
    ({ registryId }: { registryId: string }) => {
      const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
      return w.__wandaTestRenderer?.getPairedQueryCacheEntries(registryId) ?? []
    },
    { registryId },
  )
  const beforeEntry = findListTerminals(before, seed.podId)
  expect(beforeEntry, 'pod.listTerminals must be cached before mutation').toBeTruthy()
  const beforeUpdateCount = beforeEntry!.state.dataUpdateCount

  // On B, add a terminal to the pod. This emits `orpc:invalidate` with
  // `['pod', 'addTerminal', …]` and also invalidates pod.listTerminals.
  await wandaB.mainWindow.evaluate(
    async ({ podId }: { podId: string }) => {
      const w = window as unknown as { wanda: WandaAPI }
      await w.wanda.rpc.call(['pod', 'addTerminal'], {
        podId,
        name: 'post-mount-term',
        command: '/bin/sh',
        args: ['-i'],
      })
      await w.wanda.rpc.call(['pod', 'ensureStarted'], { id: podId })
    },
    { podId: seed.podId },
  )

  // A's `usePairedInvalidation` must catch B's broadcast, invalidate the
  // `['remote', registryId, 'pod.listTerminals', …]` query, and drive a
  // refetch. Assert directly on queryClient's dataUpdateCount — this
  // proves the predicate matched, independent of whether rendering has
  // caught up yet.
  const deadline = Date.now() + 10_000
  let afterEntry: CacheEntry | undefined
  while (Date.now() < deadline) {
    const entries = await wandaA.mainWindow.evaluate(
      ({ registryId }: { registryId: string }) => {
        const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
        return w.__wandaTestRenderer?.getPairedQueryCacheEntries(registryId) ?? []
      },
      { registryId },
    )
    const candidate = findListTerminals(entries, seed.podId)
    if (candidate && candidate.state.dataUpdateCount > beforeUpdateCount) {
      afterEntry = candidate
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  expect(
    afterEntry,
    `paired invalidation never fired a refetch of pod.listTerminals for registryId=${registryId} (dataUpdateCount never advanced past ${beforeUpdateCount})`,
  ).toBeTruthy()
})
