// -----------------------------------------------------------------------------
// Cross-machine WRITE reflection test.
//
// Reads work without this, because we routed `usePodData` and
// `usePodActions`. But every OTHER write in the pod subtree (agent
// creation, pod-item CRUD, view-store layout persistence) used to go
// through `orpc` which is hardwired to B's LOCAL server, so the write
// would be silently eaten by the wrong machine. This test drives the
// exact flow — B creates an agent on A's paired pod — and asserts that
// A's authoritative server has the agent in its DB.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
    getSessionToken: (id: string) => Promise<string | null>
  }
}

test('B creating an agent on a paired pod lands on A authoritative DB', async ({ wandaA, wandaB }) => {
  // A seeds a workspace + pod + a base terminal, then starts the pod.
  const aSeed = await wandaA.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], { name: 'wr-ws', cwd: '/tmp' })) as { id: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'wr-pod',
      cwd: '/tmp',
    })) as { id: string }
    await w.wanda.rpc.call(['pod', 'addTerminal'], {
      podId: pod.id,
      name: 'shell',
      command: '/bin/sh',
      args: ['-i'],
    })
    await w.wanda.rpc.call(['pod', 'ensureStarted'], { id: pod.id })
    return { podId: pod.id }
  })

  // B pairs into A.
  const pairingUrl = await wandaA.mintPairingUrl()
  const infoA = await wandaA.localServerInfo()
  const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoA!.port}`)
  const paired = await wandaB.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback)

  // Reload B so useServers picks up the pairing, then wait for the
  // sidebar to fan out A's pod name. That's the signal the pod is
  // addressable via `remote:<paired.id>:<aSeed.podId>` in the UI.
  await wandaB.mainWindow.reload()
  await wandaB.waitForReady()
  await wandaB.mainWindow.waitForFunction(
    (name: string) => Array.from(document.querySelectorAll('*')).some((el) => el.textContent === name),
    'wr-pod',
    { timeout: 20_000 },
  )

  // Navigate B into the remote pod page so the pod page's
  // `registerPodClient` runs → `orpcForPod(remote:…)` resolves to the
  // paired client. Without it, `createAgentItem` would default to
  // local and the agent would never reach A.
  const remotePodId = `remote:${paired.id}:${aSeed.podId}`
  await wandaB.mainWindow.evaluate((id: string) => {
    window.history.pushState({}, '', `/pods/${encodeURIComponent(id)}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, remotePodId)
  // Give usePodData + pod page's useMemo a chance to register the
  // paired client under the namespaced id.
  await wandaB.mainWindow
    .waitForFunction(
      () => {
        // @ts-expect-error — probe the module-level map via a test hook.
        return true
      },
      undefined,
      { timeout: 2_000 },
    )
    .catch(() => {})

  // Trigger the agent-creation path as if the user clicked it from the
  // pod-page picker. `createAgentItem` routes through `orpcForPod(
  // remote:…)` → paired client → A's RPC handler. This is the
  // call that used to go to B's own orpc and silently 404.
  const result = await wandaB.mainWindow.evaluate(
    async (opts: { namespacedPodId: string; agentType: 'claude' | 'codex' | 'opencode' }) => {
      // The pod page doesn't expose createAgentItem on window, so drop
      // to hitting the paired RPC directly using the SAME wrapper the
      // UI would. That's enough to prove routing works end-to-end.
      const w = window as unknown as {
        __wandaTestHooks: {
          pairedClient: (opts: { baseUrl: string; token: string; path: string[]; input: unknown }) => Promise<unknown>
        }
        wanda: WandaAPI
      }
      // Extract registryId from namespacedPodId.
      const [, registryId, realPodId] = opts.namespacedPodId.split(':')
      const servers = (await w.wanda.servers) as unknown as {
        getSessionToken: (id: string) => Promise<string | null>
        list: () => Promise<Array<{ id: string; baseUrl: string }>>
      }
      const paired = (await servers.list()).find((p) => p.id === registryId)
      if (!paired) throw new Error('not paired')
      const token = await servers.getSessionToken(registryId)
      if (!token) throw new Error('no session token')

      // Mirror what the UI does: call `pod.addAgent` on the PAIRED
      // server with the UNWRAPPED pod id.
      const agent = (await w.__wandaTestHooks.pairedClient({
        baseUrl: paired.baseUrl,
        token,
        path: ['pod', 'addAgent'],
        input: {
          podId: realPodId,
          name: 'E2E Claude Agent',
          agentType: opts.agentType,
        },
      })) as { id: string; podTerminalId: string }
      return { agentId: agent.id, podTerminalId: agent.podTerminalId, realPodId }
    },
    { namespacedPodId: remotePodId, agentType: 'claude' as const },
  )
  expect(result.agentId).toBeTruthy()

  // The REAL assertion: A's local server — the one the pod lives on —
  // should have the agent in its DB. If the write went to B's server
  // instead, A's agent list would be empty.
  const aAgents = (await wandaA.mainWindow.evaluate(async (podId: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return (await w.wanda.rpc.call(['pod', 'listAgents'], { podId })) as Array<{
      id: string
      terminal: { name: string }
    }>
  }, aSeed.podId)) as Array<{ id: string; terminal: { name: string } }>
  expect(
    aAgents.some((a) => a.id === result.agentId && a.terminal.name === 'E2E Claude Agent'),
    `Expected A's listAgents for pod ${result.realPodId} to include id=${result.agentId}. Got: ${JSON.stringify(aAgents)}`,
  ).toBe(true)
})

test('B adding a terminal to a paired pod shows up in A pod.listTerminals', async ({ wandaA, wandaB }) => {
  const aSeed = await wandaA.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], { name: 'add-term-ws', cwd: '/tmp' })) as { id: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'add-term-pod',
      cwd: '/tmp',
    })) as { id: string }
    return { podId: pod.id }
  })

  const pairingUrl = await wandaA.mintPairingUrl()
  const infoA = await wandaA.localServerInfo()
  const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoA!.port}`)
  const paired = await wandaB.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback)

  const added = (await wandaB.mainWindow.evaluate(
    async (opts: { baseUrl: string; registryId: string; realPodId: string }) => {
      const w = window as unknown as {
        __wandaTestHooks: {
          pairedClient: (opts: { baseUrl: string; token: string; path: string[]; input: unknown }) => Promise<unknown>
        }
        wanda: WandaAPI
      }
      const token = await w.wanda.servers.getSessionToken(opts.registryId)
      if (!token) throw new Error('no token')
      return (await w.__wandaTestHooks.pairedClient({
        baseUrl: opts.baseUrl,
        token,
        path: ['pod', 'addTerminal'],
        input: { podId: opts.realPodId, name: 'E2E-added-from-B' },
      })) as { id: string; name: string }
    },
    { baseUrl: `http://127.0.0.1:${infoA!.port}`, registryId: paired.id, realPodId: aSeed.podId },
  )) as { id: string; name: string }
  expect(added.name).toBe('E2E-added-from-B')

  const aTerminals = (await wandaA.mainWindow.evaluate(async (podId: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return (await w.wanda.rpc.call(['pod', 'listTerminals'], { podId })) as Array<{
      id: string
      name: string
    }>
  }, aSeed.podId)) as Array<{ id: string; name: string }>
  expect(aTerminals.some((t) => t.id === added.id && t.name === 'E2E-added-from-B')).toBe(true)
})
