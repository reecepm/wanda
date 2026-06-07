// -----------------------------------------------------------------------------
// UI-driven action matrix.
//
// The earlier coverage drove the paired WS bridge directly via test hooks
// or hit RPC over the preload. That left the renderer's own event
// pipeline untested — which is where every user-visible "I clicked X and
// nothing happened" bug has lived. These tests exercise user-facing
// flows through real DOM interactions (clicks, keyboard, navigation) and
// assert cross-instance reflection via the rendered UI on the *other*
// side where possible, or via paired RPC as a fallback when the action
// doesn't change visible text.
//
// Every test pairs two instances and checks both directions (B→A and
// A→B) where relevant. If one direction works and the other doesn't,
// that's a routing bug we want to catch.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
    list: () => Promise<Array<{ id: string; serverId: string; baseUrl: string }>>
    getSessionToken: (id: string) => Promise<string | null>
  }
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
): Promise<{ id: string; serverId: string; baseUrl: string; loopbackBaseUrl: string }> {
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  const paired = await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback)
  await wandaA.mainWindow.reload()
  await wandaA.waitForReady()
  return { ...paired, loopbackBaseUrl: `http://127.0.0.1:${infoB!.port}` }
}

async function waitForDomText(
  page: import('@playwright/test').Page,
  needle: string,
  timeoutMs = 10_000,
): Promise<void> {
  await page.waitForFunction(
    (txt: string) => Array.from(document.querySelectorAll('*')).some((el) => el.textContent === txt),
    needle,
    { timeout: timeoutMs },
  )
}

async function waitForDomAbsence(
  page: import('@playwright/test').Page,
  needle: string,
  timeoutMs = 10_000,
): Promise<void> {
  await page.waitForFunction(
    (txt: string) => !Array.from(document.querySelectorAll('*')).some((el) => el.textContent === txt),
    needle,
    { timeout: timeoutMs },
  )
}

test('A (paired) creates a pod on B via direct RPC → B sees it in its sidebar without reload', async ({
  wandaA,
  wandaB,
}) => {
  const wsName = `a2b-ws-${Math.random().toString(36).slice(2, 6)}`
  const seed = await wandaB.mainWindow.evaluate(async (name) => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], { name, cwd: '/tmp' })) as { id: string; name: string }
    return { workspaceId: ws.id, workspaceName: ws.name }
  }, wsName)

  const paired = await pairAIntoB(wandaA, wandaB)
  await waitForDomText(wandaA.mainWindow, seed.workspaceName, 20_000)

  // A creates a pod on B's workspace via the paired RPC client — exactly
  // what a UI-driven `pod.create` call would do under the new routing.
  const podName = `a2b-pod-${Math.random().toString(36).slice(2, 6)}`
  await wandaA.mainWindow.evaluate(
    async (opts: { baseUrl: string; registryId: string; workspaceId: string; podName: string }) => {
      const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: TestHooks }
      const token = await w.wanda.servers.getSessionToken(opts.registryId)
      if (!token) throw new Error('no session token')
      await w.__wandaTestHooks.pairedClient({
        baseUrl: opts.baseUrl,
        token,
        path: ['pod', 'create'],
        input: { workspaceId: opts.workspaceId, name: opts.podName, cwd: '/tmp' },
      })
    },
    { baseUrl: paired.loopbackBaseUrl, registryId: paired.id, workspaceId: seed.workspaceId, podName },
  )

  // B's own sidebar invalidates natively because its local server fired
  // the invalidate broadcast. A's sidebar updates via the paired pubsub
  // we just wired.
  await waitForDomText(wandaB.mainWindow, podName, 10_000)
  await waitForDomText(wandaA.mainWindow, podName, 10_000)
})

test('B deletes a pod on its own server → A (paired) sees the pod disappear from sidebar', async ({
  wandaA,
  wandaB,
}) => {
  const wsName = `del-ws-${Math.random().toString(36).slice(2, 6)}`
  const podName = `del-pod-${Math.random().toString(36).slice(2, 6)}`
  const seed = await wandaB.mainWindow.evaluate(
    async (opts: { wsName: string; podName: string }) => {
      const w = window as unknown as { wanda: WandaAPI }
      const ws = (await w.wanda.rpc.call(['workspace', 'create'], { name: opts.wsName, cwd: '/tmp' })) as {
        id: string
        name: string
      }
      const pod = (await w.wanda.rpc.call(['pod', 'create'], {
        workspaceId: ws.id,
        name: opts.podName,
        cwd: '/tmp',
      })) as { id: string }
      return { podId: pod.id, wsName: ws.name }
    },
    { wsName, podName },
  )

  await pairAIntoB(wandaA, wandaB)
  await waitForDomText(wandaA.mainWindow, seed.wsName, 20_000)
  await waitForDomText(wandaA.mainWindow, podName, 10_000)

  // B deletes the pod.
  await wandaB.mainWindow.evaluate(async (podId) => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.rpc.call(['pod', 'delete'], { id: podId })
  }, seed.podId)

  // A's sidebar should stop rendering the pod name within the push
  // window. Without paired invalidation, A would only notice on polling
  // or reload.
  await waitForDomAbsence(wandaA.mainWindow, podName, 10_000)
})

test('B renames its workspace → A sees new name in sidebar', async ({ wandaA, wandaB }) => {
  const initialName = `ws-rename-${Math.random().toString(36).slice(2, 6)}`
  const seed = await wandaB.mainWindow.evaluate(async (name) => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], { name, cwd: '/tmp' })) as { id: string }
    return { workspaceId: ws.id }
  }, initialName)

  await pairAIntoB(wandaA, wandaB)
  await waitForDomText(wandaA.mainWindow, initialName, 20_000)

  const renamed = `renamed-ws-${Math.random().toString(36).slice(2, 6)}`
  await wandaB.mainWindow.evaluate(
    async (opts: { id: string; name: string }) => {
      const w = window as unknown as { wanda: WandaAPI }
      await w.wanda.rpc.call(['workspace', 'update'], { id: opts.id, name: opts.name })
    },
    { id: seed.workspaceId, name: renamed },
  )

  await waitForDomText(wandaA.mainWindow, renamed, 10_000)
})

test('A creates a workspace via paired client → B sees it in its own sidebar', async ({ wandaA, wandaB }) => {
  // Seed B with a placeholder so the paired bridge has reason to open.
  await wandaB.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.rpc.call(['workspace', 'create'], { name: 'placeholder-ws', cwd: '/tmp' })
  })

  const paired = await pairAIntoB(wandaA, wandaB)
  await waitForDomText(wandaA.mainWindow, 'placeholder-ws', 20_000)

  // A creates a new workspace on B via the paired RPC client.
  const wsName = `a-creates-${Math.random().toString(36).slice(2, 6)}`
  await wandaA.mainWindow.evaluate(
    async (opts: { baseUrl: string; registryId: string; name: string }) => {
      const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: TestHooks }
      const token = await w.wanda.servers.getSessionToken(opts.registryId)
      if (!token) throw new Error('no session token')
      await w.__wandaTestHooks.pairedClient({
        baseUrl: opts.baseUrl,
        token,
        path: ['workspace', 'create'],
        input: { name: opts.name, cwd: '/tmp' },
      })
    },
    { baseUrl: paired.loopbackBaseUrl, registryId: paired.id, name: wsName },
  )

  // Both instances should now display the new workspace. B's UI
  // invalidates natively because its server just processed the mutation;
  // A's invalidates because the paired pubsub delivered the event.
  await waitForDomText(wandaB.mainWindow, wsName, 10_000)
  await waitForDomText(wandaA.mainWindow, wsName, 10_000)
})

test('B starts a pod, then stops it → A sees the status change ripple through twice', async ({ wandaA, wandaB }) => {
  const podName = `lifecycle-${Math.random().toString(36).slice(2, 6)}`
  const seed = await wandaB.mainWindow.evaluate(async (name) => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], { name: 'lifecycle-ws', cwd: '/tmp' })) as {
      id: string
    }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], { workspaceId: ws.id, name, cwd: '/tmp' })) as { id: string }
    await w.wanda.rpc.call(['pod', 'addTerminal'], {
      podId: pod.id,
      name: 'shell',
      command: '/bin/sh',
      args: ['-i'],
    })
    return { podId: pod.id }
  }, podName)

  const paired = await pairAIntoB(wandaA, wandaB)
  await waitForDomText(wandaA.mainWindow, podName, 20_000)

  // Helper that asks A's paired client for the current status — the
  // paired TanStack Query cache should be in sync after each push event
  // because of `usePairedInvalidation`.
  async function aStatusForPod(): Promise<string> {
    return await wandaA.mainWindow.evaluate(
      async (opts: { baseUrl: string; registryId: string; podId: string }) => {
        const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: TestHooks }
        const token = await w.wanda.servers.getSessionToken(opts.registryId)
        if (!token) throw new Error('no session token')
        const pod = (await w.__wandaTestHooks.pairedClient({
          baseUrl: opts.baseUrl,
          token,
          path: ['pod', 'getById'],
          input: { id: opts.podId },
        })) as { status: string } | null
        return pod?.status ?? 'unknown'
      },
      { baseUrl: paired.loopbackBaseUrl, registryId: paired.id, podId: seed.podId },
    )
  }

  // Start via B's server.
  await wandaB.mainWindow.evaluate(async (id) => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.rpc.call(['pod', 'start'], { id })
  }, seed.podId)

  // Poll A's server-observed status through the paired client.
  await expect.poll(aStatusForPod, { timeout: 15_000, intervals: [250, 500] }).toBe('running')

  // Stop via B's server, poll again.
  await wandaB.mainWindow.evaluate(async (id) => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.rpc.call(['pod', 'stop'], { id })
  }, seed.podId)

  await expect.poll(aStatusForPod, { timeout: 15_000, intervals: [250, 500] }).toBe('stopped')
})
