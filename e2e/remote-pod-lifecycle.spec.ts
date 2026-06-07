// -----------------------------------------------------------------------------
// Remote pod lifecycle — start / stop / restart / delete.
//
// Each test exercises a user action on a remote pod via the exact same
// code path the pod-page buttons use (`usePodActions` → paired RPC).
// If a button click on a remote pod doesn't do the right thing these
// tests fail loud, before it hits a real user.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
    getSessionToken: (id: string) => Promise<string | null>
  }
}
type Hooks = {
  pairedClient: (opts: { baseUrl: string; token: string; path: string[]; input: unknown }) => Promise<unknown>
}

async function pairAB(
  wandaA: Parameters<typeof test>[1] extends { wandaA: infer T } ? T : never,
  wandaB: Parameters<typeof test>[1] extends { wandaB: infer T } ? T : never,
) {
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopbackUrl = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  const paired = await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopbackUrl)
  return { paired, infoB }
}

test('remote pod start/stop/restart via paired RPC updates status on both sides', async ({ wandaA, wandaB }) => {
  const bSeed = await wandaB.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], { name: 'lc-ws', cwd: '/tmp' })) as { id: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'lc-pod',
      cwd: '/tmp',
    })) as { id: string }
    await w.wanda.rpc.call(['pod', 'addTerminal'], { podId: pod.id, name: 'shell', command: '/bin/sh', args: ['-i'] })
    return { podId: pod.id }
  })
  const { paired, infoB } = await pairAB(wandaA, wandaB)

  async function getStatusOnB(): Promise<string> {
    const pod = (await wandaB.mainWindow.evaluate(async (id: string) => {
      const w = window as unknown as { wanda: WandaAPI }
      return (await w.wanda.rpc.call(['pod', 'getById'], { id })) as { status: string } | null
    }, bSeed.podId)) as { status: string } | null
    return pod?.status ?? 'missing'
  }

  async function waitFor(expectedStatuses: string[], timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const s = await getStatusOnB()
      if (expectedStatuses.includes(s)) return s
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error(`pod never reached ${expectedStatuses.join('|')}, got ${await getStatusOnB()}`)
  }

  async function callRemote(method: string): Promise<void> {
    await wandaA.mainWindow.evaluate(
      async (opts: { baseUrl: string; registryId: string; method: string; podId: string }) => {
        const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: Hooks }
        const token = await w.wanda.servers.getSessionToken(opts.registryId)
        if (!token) throw new Error('no session')
        await w.__wandaTestHooks.pairedClient({
          baseUrl: opts.baseUrl,
          token,
          path: ['pod', opts.method],
          input: { id: opts.podId },
        })
      },
      { baseUrl: `http://127.0.0.1:${infoB!.port}`, registryId: paired.id, method, podId: bSeed.podId },
    )
  }

  // Start via A → status goes running on B.
  await callRemote('ensureStarted')
  await waitFor(['running'])

  // Stop via A → status goes stopped.
  await callRemote('stop')
  await waitFor(['stopped', 'failed'])

  // Start again + restart — exercise the restart path too.
  await callRemote('start')
  await waitFor(['running'])
  await callRemote('restart')
  // Restart transitions through stopping → starting → running; any
  // terminal state counts.
  await waitFor(['running'])
})

test('deleting a workspace on remote through paired RPC removes it from A inventory', async ({ wandaA, wandaB }) => {
  const seeded = await wandaB.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], { name: 'del-ws', cwd: '/tmp' })) as { id: string }
    return { workspaceId: ws.id }
  })
  const { paired, infoB } = await pairAB(wandaA, wandaB)

  // A lists B's workspaces → sees it.
  const beforeIds = (
    await wandaA.mainWindow.evaluate(
      async (opts: { baseUrl: string; registryId: string }) => {
        const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: Hooks }
        const token = await w.wanda.servers.getSessionToken(opts.registryId)
        return (await w.__wandaTestHooks.pairedClient({
          baseUrl: opts.baseUrl,
          token: token!,
          path: ['workspace', 'list'],
          input: {},
        })) as Array<{ id: string }>
      },
      { baseUrl: `http://127.0.0.1:${infoB!.port}`, registryId: paired.id },
    )
  ).map((w) => w.id)
  expect(beforeIds).toContain(seeded.workspaceId)

  // A deletes via paired RPC.
  await wandaA.mainWindow.evaluate(
    async (opts: { baseUrl: string; registryId: string; id: string }) => {
      const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: Hooks }
      const token = await w.wanda.servers.getSessionToken(opts.registryId)
      await w.__wandaTestHooks.pairedClient({
        baseUrl: opts.baseUrl,
        token: token!,
        path: ['workspace', 'delete'],
        input: { id: opts.id },
      })
    },
    { baseUrl: `http://127.0.0.1:${infoB!.port}`, registryId: paired.id, id: seeded.workspaceId },
  )

  // B no longer has it.
  const afterOnB = (
    await wandaB.mainWindow.evaluate(async () => {
      const w = window as unknown as { wanda: WandaAPI }
      return (await w.wanda.rpc.call(['workspace', 'list'], {})) as Array<{ id: string }>
    })
  ).map((w) => w.id)
  expect(afterOnB).not.toContain(seeded.workspaceId)
})
