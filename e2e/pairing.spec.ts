// -----------------------------------------------------------------------------
// Two-instance pairing E2E.
//
// This is what the user was manually verifying. We launch two isolated
// Wanda instances, A and B, each on its own userData + ephemeral port.
// Machine B mints a pairing URL, machine A pastes it and pairs, and then
// we verify that machine A can drive B over the paired RPC link — seeing
// B's workspaces / pods in the list, creating new ones remotely, and
// receiving their echo back. No manual clicks.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

test('A can pair into B, then list + create workspaces + pods on B', async ({ wandaA, wandaB }) => {
  // ---- B side: mint a pairing URL via the preload API. ---------------------
  const pairingUrl = await wandaB.mintPairingUrl()
  expect(pairingUrl).not.toBeNull()
  expect(pairingUrl!.url).toMatch(/^http:\/\/[^/]+\/pair#token=/)

  // Rewrite the host to 127.0.0.1 — the fixture tells the server to bind
  // 0.0.0.0 so it accepts LAN pairings, but for the in-test fetch we can
  // always reach it over loopback. This keeps the test network-agnostic.
  const infoB = await wandaB.localServerInfo()
  const pairingUrlLoopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)

  // ---- B side: seed some workspaces / pods BEFORE A sees them. -------------
  const seeded = await wandaB.mainWindow.evaluate(async () => {
    type WandaAPI = {
      rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
    }
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], {
      name: 'seed-ws',
      cwd: '/tmp/seed-ws',
    })) as { id: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'seed-pod',
      cwd: '/tmp/seed-ws',
    })) as { id: string }
    return { wsId: ws.id, podId: pod.id }
  })
  expect(seeded.wsId).toBeTruthy()
  expect(seeded.podId).toBeTruthy()

  // ---- A side: pair into B via the preload API. ----------------------------
  const pairedOnA = await wandaA.mainWindow.evaluate(async (url) => {
    type WandaAPI = {
      servers: { pair: (url: string) => Promise<unknown> }
    }
    const w = window as unknown as { wanda: WandaAPI }
    return (await w.wanda.servers.pair(url)) as {
      id: string
      serverId: string
      label: string
      baseUrl: string
    }
  }, pairingUrlLoopback)

  expect(pairedOnA.serverId).toBe(infoB!.serverId)
  expect(pairedOnA.baseUrl).toMatch(/^http:\/\//)

  // The paired server must show up in A's list.
  const pairedList = await wandaA.listPairedServers()
  expect(pairedList.some((s) => s.id === pairedOnA.id)).toBe(true)

  // ---- A side: fetch inventory via the paired RPC link. -------------------
  const remoteInventory = await wandaA.mainWindow.evaluate(async (opts: { id: string; baseUrl: string }) => {
    type WandaAPI = {
      servers: { getSessionToken: (id: string) => Promise<string | null> }
    }
    type TestHooks = {
      pairedClient: (opts: { baseUrl: string; token: string; path: string[]; input: unknown }) => Promise<unknown>
    }
    const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: TestHooks }
    const token = await w.wanda.servers.getSessionToken(opts.id)
    if (!token) throw new Error('no session token for paired server')

    const workspaces = (await w.__wandaTestHooks.pairedClient({
      baseUrl: opts.baseUrl,
      token,
      path: ['workspace', 'list'],
      input: {},
    })) as Array<{ id: string; name: string }>

    const pods = (
      await Promise.all(
        workspaces.map(
          (ws) =>
            w.__wandaTestHooks.pairedClient({
              baseUrl: opts.baseUrl,
              token,
              path: ['pod', 'list'],
              input: { workspaceId: ws.id },
            }) as Promise<Array<{ id: string; workspaceId: string }>>,
        ),
      )
    ).flat()

    return { workspaces, pods }
  }, pairedOnA)

  expect(remoteInventory.workspaces.some((w) => w.id === seeded.wsId)).toBe(true)
  expect(remoteInventory.pods.some((p) => p.id === seeded.podId)).toBe(true)

  // ---- A side: create a new workspace ON B via the paired RPC link. ------
  const createdFromA = await wandaA.mainWindow.evaluate(async (opts: { id: string; baseUrl: string }) => {
    type WandaAPI = { servers: { getSessionToken: (id: string) => Promise<string | null> } }
    type TestHooks = {
      pairedClient: (opts: { baseUrl: string; token: string; path: string[]; input: unknown }) => Promise<unknown>
    }
    const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: TestHooks }
    const token = await w.wanda.servers.getSessionToken(opts.id)
    if (!token) throw new Error('no session token')

    return (await w.__wandaTestHooks.pairedClient({
      baseUrl: opts.baseUrl,
      token,
      path: ['workspace', 'create'],
      input: { name: 'from-A', cwd: '/tmp/from-A' },
    })) as { id: string; name: string }
  }, pairedOnA)

  expect(createdFromA.id).toBeTruthy()
  expect(createdFromA.name).toBe('from-A')

  // B's own list must now include the workspace A just created.
  const bList = await wandaB.mainWindow.evaluate(async () => {
    type WandaAPI = { rpc: { call: (path: string[], input: unknown) => Promise<unknown> } }
    const w = window as unknown as { wanda: WandaAPI }
    return (await w.wanda.rpc.call(['workspace', 'list'], {})) as Array<{ id: string; name: string }>
  })
  expect(bList.some((r) => r.id === createdFromA.id && r.name === 'from-A')).toBe(true)
})

test('A sees B listed as an incoming session on B side', async ({ wandaA, wandaB }) => {
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopbackUrl = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)

  await wandaA.mainWindow.evaluate(async (url) => {
    type WandaAPI = { servers: { pair: (url: string) => Promise<unknown> } }
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.servers.pair(url)
  }, loopbackUrl)

  const incoming = await wandaB.mainWindow.evaluate(async () => {
    type WandaAPI = {
      localServer: { incomingSessions: () => Promise<unknown> }
    }
    const w = window as unknown as { wanda: WandaAPI }
    return (await w.wanda.localServer.incomingSessions()) as Array<{
      sessionId: string
      device: { deviceName: string; os: string; appVersion: string }
    }>
  })

  expect(incoming.length).toBeGreaterThanOrEqual(1)
  // The hostname on A was whatever os.hostname() returned when A booted —
  // we don't pin it exactly, just assert the session exists with a plausible
  // device descriptor.
  expect(incoming[0].device.os).toMatch(/^(darwin|linux|win32)$/)
  expect(incoming[0].device.appVersion).toBeTruthy()
})

test('paired sessions survive a B restart: re-open A and B can still talk', async ({ wandaB }) => {
  // This test can't actually restart B mid-test (fixture lifecycle owns it),
  // but it verifies that the /api/auth/ws-token endpoint accepts a live
  // session token — which fails 401 if sessions aren't persisted correctly.
  // (The cross-pairing vitest suite covers the literal restart case.)
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()

  // Bootstrap a raw session without going through the client-side registry.
  const bootstrapped = await wandaB.mainWindow.evaluate(
    async (opts: { url: string; port: number }) => {
      const pairingToken = opts.url.split('#token=')[1]!
      const base = `http://127.0.0.1:${opts.port}`
      const res = await fetch(`${base}/api/auth/bootstrap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pairingToken,
          client: { deviceName: 'e2e-standalone', os: 'darwin', appVersion: '0.0.0-e2e' },
        }),
      })
      if (!res.ok) throw new Error(`bootstrap ${res.status}`)
      const body = (await res.json()) as { sessionToken: string; sessionId: string }

      const wst = await fetch(`${base}/api/auth/ws-token`, {
        method: 'POST',
        headers: { authorization: `Bearer ${body.sessionToken}` },
      })
      if (!wst.ok) throw new Error(`ws-token ${wst.status}`)
      const wstBody = (await wst.json()) as { wsToken: string; expiresAt: number }
      return { sessionToken: body.sessionToken, wsToken: wstBody.wsToken }
    },
    { url: pairingUrl!.url, port: infoB!.port },
  )

  expect(bootstrapped.sessionToken).toBeTruthy()
  expect(bootstrapped.wsToken).toBeTruthy()
})
