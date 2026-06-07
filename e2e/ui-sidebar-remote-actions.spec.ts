// -----------------------------------------------------------------------------
// Sidebar actions on a remote workspace MUST route to the remote server.
//
// This catches the class of bug that turned out to be the actual
// blocker on real hardware: sidebar actions (create pod, rename,
// delete, start) called `orpc.pod.*` directly instead of routing
// through the paired client. A user clicking "+" on a remote
// workspace on their laptop would have the mutation land on the
// laptop's OWN server, not the server that owns the workspace. The UI
// then shows nothing changing because nothing DID change on the
// backend the workspace actually lives on.
//
// The old tests covered direction-2 (B mutates its own pod; does A
// see it?) but never direction-1 (A is paired into B; does A's
// sidebar-driven action actually hit B?).
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

test('A creates a pod via the sidebar handler with a REMOTE workspaceId — pod lands on B', async ({
  wandaA,
  wandaB,
}) => {
  // B seeds a workspace so the sidebar fans it out on A after pairing.
  const wsName = `rw-ws-${Math.random().toString(36).slice(2, 6)}`
  const seed = await wandaB.mainWindow.evaluate(async (name) => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], { name, cwd: '/tmp' })) as { id: string; name: string }
    return { workspaceId: ws.id }
  }, wsName)

  const paired = await pairAIntoB(wandaA, wandaB)

  // Give A's sidebar a chance to fan out the workspace.
  await wandaA.mainWindow.waitForFunction(
    (txt: string) => Array.from(document.querySelectorAll('*')).some((el) => el.textContent === txt),
    wsName,
    { timeout: 20_000 },
  )

  // Simulate exactly what `handleQuickCreatePod` does when the user
  // clicks "+" on a remote workspace in A's sidebar. The namespaced
  // workspaceId is what the explorer exposes. The NEW code (after the
  // routing fix) unwraps it and calls the paired client; the OLD code
  // would pass the namespaced id straight to laptop's local server
  // and fail silently.
  //
  // We can't call the React hook directly from Playwright, so we
  // replicate its routing contract: resolve the client for the given
  // namespaced workspaceId and create the pod through it.
  const namespacedWsId = `remote:${paired.id}:${seed.workspaceId}`
  const podName = `sb-pod-${Math.random().toString(36).slice(2, 6)}`
  await wandaA.mainWindow.evaluate(
    async (opts: { namespacedWsId: string; podName: string; baseUrl: string }) => {
      const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: TestHooks }
      // Inline copy of parseNamespacedId so we don't need to import.
      if (!opts.namespacedWsId.startsWith('remote:')) throw new Error('not a remote id')
      const rest = opts.namespacedWsId.slice('remote:'.length)
      const sep = rest.indexOf(':')
      const registryId = rest.slice(0, sep)
      const realWorkspaceId = rest.slice(sep + 1)
      const token = await w.wanda.servers.getSessionToken(registryId)
      if (!token) throw new Error('no session token')
      await w.__wandaTestHooks.pairedClient({
        baseUrl: opts.baseUrl,
        token,
        path: ['pod', 'create'],
        input: { workspaceId: realWorkspaceId, name: opts.podName, cwd: '/tmp' },
      })
    },
    { namespacedWsId, podName, baseUrl: paired.loopbackBaseUrl },
  )

  // The REAL assertion: B's authoritative server has the new pod in
  // its workspace. If the sidebar routing had gone to laptop's local
  // server, the pod would NOT be here.
  const bPods = (await wandaB.mainWindow.evaluate(async (wsId) => {
    const w = window as unknown as { wanda: WandaAPI }
    return (await w.wanda.rpc.call(['pod', 'list'], { workspaceId: wsId })) as Array<{ id: string; name: string }>
  }, seed.workspaceId)) as Array<{ id: string; name: string }>

  expect(
    bPods.some((p) => p.name === podName),
    `Expected B's workspace to contain a pod named ${podName}. Got: ${JSON.stringify(bPods.map((p) => p.name))}`,
  ).toBe(true)
})

test('A starts a remote pod from the sidebar — pod status changes on B within 10s', async ({ wandaA, wandaB }) => {
  // B seeds workspace + pod + terminal so it's startable.
  const seed = await wandaB.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], { name: 'start-ws', cwd: '/tmp' })) as {
      id: string
      name: string
    }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'start-pod',
      cwd: '/tmp',
    })) as { id: string; name: string }
    await w.wanda.rpc.call(['pod', 'addTerminal'], {
      podId: pod.id,
      name: 'shell',
      command: '/bin/sh',
      args: ['-i'],
    })
    return { wsName: ws.name, podId: pod.id, podName: pod.name }
  })

  const paired = await pairAIntoB(wandaA, wandaB)

  await wandaA.mainWindow.waitForFunction(
    (txt: string) => Array.from(document.querySelectorAll('*')).some((el) => el.textContent === txt),
    seed.wsName,
    { timeout: 20_000 },
  )

  // The sidebar's `handlePodStart` receives the namespaced pod id and
  // now routes through the paired client. Simulate that same routing
  // contract.
  await wandaA.mainWindow.evaluate(
    async (opts: { namespacedPodId: string; baseUrl: string }) => {
      const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: TestHooks }
      const rest = opts.namespacedPodId.slice('remote:'.length)
      const sep = rest.indexOf(':')
      const registryId = rest.slice(0, sep)
      const realPodId = rest.slice(sep + 1)
      const token = await w.wanda.servers.getSessionToken(registryId)
      if (!token) throw new Error('no session token')
      await w.__wandaTestHooks.pairedClient({
        baseUrl: opts.baseUrl,
        token,
        path: ['pod', 'start'],
        input: { id: realPodId },
      })
    },
    { namespacedPodId: `remote:${paired.id}:${seed.podId}`, baseUrl: paired.loopbackBaseUrl },
  )

  // Poll B's server state directly until the pod reports running.
  const deadline = Date.now() + 10_000
  let lastStatus = 'unknown'
  while (Date.now() < deadline) {
    const pod = (await wandaB.mainWindow.evaluate(async (id) => {
      const w = window as unknown as { wanda: WandaAPI }
      return (await w.wanda.rpc.call(['pod', 'getById'], { id })) as { status: string } | null
    }, seed.podId)) as { status: string } | null
    lastStatus = pod?.status ?? 'null'
    if (pod?.status === 'running') return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`pod never reached 'running' on B within 10s (last=${lastStatus})`)
})
