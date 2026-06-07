// -----------------------------------------------------------------------------
// Sidebar rendering + recovery scenarios.
//
// The user's first-impression flow is: pair → sidebar shows remote
// workspaces → click pod → terminal works. If any step is broken, they
// rage. These tests pin down each step plus the recovery cases ("I
// restarted Wanda and have to re-pair every time") that have bitten us.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string; label: string }>
    list: () => Promise<Array<{ id: string; serverId: string; label: string; baseUrl: string }>>
    remove: (id: string) => Promise<void>
    getSessionToken: (id: string) => Promise<string | null>
  }
}
type Hooks = {
  pairedClient: (opts: { baseUrl: string; token: string; path: string[]; input: unknown }) => Promise<unknown>
}

test("pairing surfaces B's workspace in A's sidebar after a reload", async ({ wandaA, wandaB }) => {
  const bSeed = await wandaB.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], {
      name: 'sidebar-ws-xyz',
      cwd: '/tmp',
    })) as { id: string; name: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'sidebar-pod-xyz',
      cwd: '/tmp',
    })) as { id: string; name: string }
    return { workspaceName: ws.name, podName: pod.name }
  })
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopbackUrl = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.servers.pair(url)
  }, loopbackUrl)

  // Reload A so useServers starts fresh — matches the first-use flow
  // where the user restarts after pairing. The sidebar should paint
  // the remote workspace name.
  await wandaA.mainWindow.reload()
  await wandaA.waitForReady()

  await wandaA.mainWindow.waitForFunction(
    (name: string) => Array.from(document.querySelectorAll('*')).some((el) => el.textContent === name),
    bSeed.workspaceName,
    { timeout: 20_000 },
  )

  // And the pod under it.
  await wandaA.mainWindow.waitForFunction(
    (name: string) => Array.from(document.querySelectorAll('*')).some((el) => el.textContent === name),
    bSeed.podName,
    { timeout: 20_000 },
  )
})

test('paired session survives A reload without re-pairing', async ({ wandaA, wandaB }) => {
  // Set up a pairing + do a paired RPC call → reload → same paired RPC
  // call still works. Exercises client-db persistence + server
  // SessionStore hydration + RPCLink regeneration post-reload.
  await wandaB.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.rpc.call(['workspace', 'create'], { name: 'persist-ws', cwd: '/tmp' })
  })
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopbackUrl = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  const paired = await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopbackUrl)

  // First call works.
  const beforeReload = (await wandaA.mainWindow.evaluate(
    async (opts: { baseUrl: string; registryId: string }) => {
      const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: Hooks }
      const token = await w.wanda.servers.getSessionToken(opts.registryId)
      return (await w.__wandaTestHooks.pairedClient({
        baseUrl: opts.baseUrl,
        token: token!,
        path: ['workspace', 'list'],
        input: {},
      })) as Array<{ name: string }>
    },
    { baseUrl: `http://127.0.0.1:${infoB!.port}`, registryId: paired.id },
  )) as Array<{ name: string }>
  expect(beforeReload.some((w) => w.name === 'persist-ws')).toBe(true)

  await wandaA.mainWindow.reload()
  await wandaA.waitForReady()

  // After reload A still has the pairing in client.db.
  const pairedList = (await wandaA.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.list()
  })) as Array<{ id: string; baseUrl: string }>
  expect(pairedList.some((p) => p.id === paired.id)).toBe(true)

  // And the session token still validates on B.
  const afterReload = (await wandaA.mainWindow.evaluate(
    async (opts: { baseUrl: string; registryId: string }) => {
      const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: Hooks }
      const token = await w.wanda.servers.getSessionToken(opts.registryId)
      return (await w.__wandaTestHooks.pairedClient({
        baseUrl: opts.baseUrl,
        token: token!,
        path: ['workspace', 'list'],
        input: {},
      })) as Array<{ name: string }>
    },
    { baseUrl: `http://127.0.0.1:${infoB!.port}`, registryId: paired.id },
  )) as Array<{ name: string }>
  expect(afterReload.some((w) => w.name === 'persist-ws')).toBe(true)
})

test('unpair + immediate re-pair into the same server works without duplicate rows', async ({ wandaA, wandaB }) => {
  const pairingUrl1 = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopback1 = pairingUrl1!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  const first = await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback1)

  // Unpair.
  await wandaA.mainWindow.evaluate(async (id: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.servers.remove(id)
  }, first.id)
  const afterRemove = (await wandaA.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.list()
  })) as Array<{ id: string }>
  expect(afterRemove.some((p) => p.id === first.id)).toBe(false)

  // Re-pair with a fresh URL.
  const pairingUrl2 = await wandaB.mintPairingUrl()
  const loopback2 = pairingUrl2!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  const second = await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback2)
  expect(second.id).not.toBe(first.id)
  expect(second.serverId).toBe(first.serverId)

  const now = (await wandaA.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.list()
  })) as Array<{ id: string; serverId: string }>
  const matching = now.filter((p) => p.serverId === first.serverId)
  expect(matching).toHaveLength(1)
})

test('pair a second time without unpairing replaces (no UNIQUE constraint crash)', async ({ wandaA, wandaB }) => {
  const pairingUrl1 = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopback1 = pairingUrl1!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  const first = await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback1)

  // Immediately pair again to the same server id. Client registry
  // must replace rather than throw UNIQUE(server_id).
  const pairingUrl2 = await wandaB.mintPairingUrl()
  const loopback2 = pairingUrl2!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  const second = await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback2)
  expect(second.id).not.toBe(first.id)

  const list = (await wandaA.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.list()
  })) as Array<{ id: string; serverId: string }>
  expect(list.filter((p) => p.serverId === first.serverId)).toHaveLength(1)
  expect(list[0].id).toBe(second.id)
})

test('invalid pairing URL is rejected without touching client state', async ({ wandaA }) => {
  const beforeList = await wandaA.listPairedServers()
  const err = await wandaA.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    try {
      await w.wanda.servers.pair('not-a-url')
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  })
  expect(err).toBeTruthy()
  expect(err).toMatch(/invalid pairing/i)
  const afterList = await wandaA.listPairedServers()
  expect(afterList.length).toBe(beforeList.length)
})
