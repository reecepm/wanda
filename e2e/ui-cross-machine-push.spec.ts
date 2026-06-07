// -----------------------------------------------------------------------------
// Cross-machine push tests.
//
// B (authoritative for a pod) makes a change; A (paired client viewing B's
// resources) must see it without a manual reload. Without a paired event
// subscription A's renderer only listens on its own LOCAL server's WS, so
// B-side events never reach A's TanStack Query cache — these specs gate
// that subscription staying healthy.
// -----------------------------------------------------------------------------

import { test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
  }
}

async function pairAIntoB(
  wandaA: { mainWindow: import('@playwright/test').Page; waitForReady: () => Promise<void> },
  wandaB: {
    mintPairingUrl: () => Promise<{ url: string; expiresAt: number } | null>
    localServerInfo: () => Promise<{ port: number; serverId: string } | null>
  },
): Promise<{ id: string; serverId: string; baseUrl: string }> {
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  const paired = await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback)
  await wandaA.mainWindow.reload()
  await wandaA.waitForReady()
  return paired
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

test('B creates a pod after A is paired → A sidebar shows the pod within 10s without reload', async ({
  wandaA,
  wandaB,
}) => {
  // B seeds a workspace so A can fan it out on the sidebar after pairing.
  const wsName = `push-ws-${Math.random().toString(36).slice(2, 6)}`
  await wandaB.mainWindow.evaluate(async (name) => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.rpc.call(['workspace', 'create'], { name, cwd: '/tmp' })
  }, wsName)

  await pairAIntoB(wandaA, wandaB)

  // A should have rendered B's workspace name in the sidebar.
  await waitForDomText(wandaA.mainWindow, wsName, 20_000)

  // Now B creates a pod under that workspace AFTER A has settled. The
  // question: does A see it without a reload?
  const podName = `push-pod-${Math.random().toString(36).slice(2, 6)}`
  await wandaB.mainWindow.evaluate(
    async (opts: { wsName: string; podName: string }) => {
      const w = window as unknown as { wanda: WandaAPI }
      const wsList = (await w.wanda.rpc.call(['workspace', 'list'], {})) as Array<{ id: string; name: string }>
      const ws = wsList.find((x) => x.name === opts.wsName)
      if (!ws) throw new Error('workspace missing on B')
      await w.wanda.rpc.call(['pod', 'create'], { workspaceId: ws.id, name: opts.podName, cwd: '/tmp' })
    },
    { wsName, podName },
  )

  // The actual assertion: A's sidebar updates without reload. This is
  // the foundational push gap — we expect this to FAIL until paired WS
  // event subscription lands.
  await waitForDomText(wandaA.mainWindow, podName, 10_000)
})

test('B renames a pod → A sidebar shows the new name within 10s', async ({ wandaA, wandaB }) => {
  // B seeds an existing pod with a known initial name.
  const initialName = `init-pod-${Math.random().toString(36).slice(2, 6)}`
  const wsName = `rename-ws-${Math.random().toString(36).slice(2, 6)}`
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
      return { workspaceId: ws.id, podId: pod.id }
    },
    { wsName, podName: initialName },
  )

  await pairAIntoB(wandaA, wandaB)

  // Confirm A's sidebar fanned out the workspace + initial pod name.
  await waitForDomText(wandaA.mainWindow, wsName, 20_000)
  await waitForDomText(wandaA.mainWindow, initialName, 10_000)

  // B renames the pod. The new name should appear on A's sidebar.
  const renamedTo = `renamed-pod-${Math.random().toString(36).slice(2, 6)}`
  await wandaB.mainWindow.evaluate(
    async (opts: { podId: string; name: string }) => {
      const w = window as unknown as { wanda: WandaAPI }
      await w.wanda.rpc.call(['pod', 'update'], { id: opts.podId, name: opts.name })
    },
    { podId: seed.podId, name: renamedTo },
  )

  await waitForDomText(wandaA.mainWindow, renamedTo, 10_000)
})
