// -----------------------------------------------------------------------------
// Production paired-bridge lifecycle.
//
// Every other paired-client spec goes through the `__wandaTestHooks`
// preload bridge, which is a *parallel* implementation of the same
// protocol. That parallel path has masked real bugs in the actual
// renderer-side `paired-terminal-bridge.ts` — notably the silent
// hello-handshake failure where WS open succeeded but the gateway parked
// every socket in `pending-hello` and dropped every broadcast + every
// outgoing envelope.
//
// This spec exercises the PRODUCTION `getPairedTerminalBridge()` directly
// via `__wandaTestRenderer.openProductionPairedBridge`. If `paired-
// terminal-bridge.ts` ever regresses on envelope version, hello payload
// shape, or post-handshake subscription wiring, this test fails in
// seconds — no PTY spawn, no UI clicks, no timing races.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
  }
}

type TestRenderer = {
  openProductionPairedBridge: (registryId: string) => Promise<void>
  getRecordedInvalidates: (registryId: string) => Array<{ namespace: string; method: string }>
  closeProductionPairedBridge: (registryId: string) => Promise<void>
}

test('production paired-terminal-bridge completes hello and relays orpc:invalidate', async ({ wandaA, wandaB }) => {
  // Pair A into B via the preload registry — same path as the UI.
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  const paired = await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback)
  expect(paired.serverId).toBe(infoB!.serverId)

  // Open the PRODUCTION bridge on A. If the hello handshake fails (wrong
  // envelope version, missing `v`, malformed payload, etc.) this
  // rejects and the test fails — exactly the signal we want.
  await wandaA.mainWindow.evaluate(async (registryId: string) => {
    const w = window as unknown as { __wandaTestRenderer: TestRenderer }
    await w.__wandaTestRenderer.openProductionPairedBridge(registryId)
  }, paired.id)

  // Trigger a mutation on B. B's server broadcasts `orpc:invalidate` to
  // every ready WS client; A's production bridge should receive it and
  // forward to its `onInvalidate` subscribers (the renderer's
  // `usePairedInvalidation` hook — or, here, our recorder).
  const seeded = await wandaB.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], {
      name: 'bridge-inv-ws',
      cwd: '/tmp/bridge-inv-ws',
    })) as { id: string }
    return { wsId: ws.id }
  })
  expect(seeded.wsId).toBeTruthy()

  // Poll the bridge's recorded invalidates. If the production bridge is
  // silent (stuck in pending-hello, or dropping v:2 envelopes, or just
  // broken) this never resolves and fails on the 5s cap.
  const received = await wandaA.mainWindow.evaluate(async (registryId: string) => {
    const w = window as unknown as { __wandaTestRenderer: TestRenderer }
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const seen = w.__wandaTestRenderer.getRecordedInvalidates(registryId)
      if (seen.some((e) => e.namespace === 'workspace' && e.method === 'create')) return seen
      await new Promise((r) => setTimeout(r, 50))
    }
    return w.__wandaTestRenderer.getRecordedInvalidates(registryId)
  }, paired.id)

  expect(received.some((e) => e.namespace === 'workspace' && e.method === 'create')).toBe(true)

  // Teardown.
  await wandaA.mainWindow.evaluate(async (registryId: string) => {
    const w = window as unknown as { __wandaTestRenderer: TestRenderer }
    await w.__wandaTestRenderer.closeProductionPairedBridge(registryId)
  }, paired.id)
})

test('production paired-terminal-bridge open resolves against a happy server', async ({ wandaA, wandaB }) => {
  // Sanity-check sibling to the end-to-end test above. Previously this
  // test was misnamed "surfaces hello-rejected as a rejection" but only
  // exercised the happy path. A true hello-rejected rejection requires
  // forging an invalid wsToken or revoking mid-handshake — both sit
  // below the public `__wandaTestRenderer` surface and belong in a unit
  // test against ClientConnection rather than a spawned-Electron spec.
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  const paired = await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback)

  const openResult = await wandaA.mainWindow.evaluate(async (registryId: string) => {
    const w = window as unknown as { __wandaTestRenderer: TestRenderer }
    try {
      await w.__wandaTestRenderer.openProductionPairedBridge(registryId)
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }, paired.id)

  expect(openResult.ok).toBe(true)

  await wandaA.mainWindow.evaluate(async (registryId: string) => {
    const w = window as unknown as { __wandaTestRenderer: TestRenderer }
    await w.__wandaTestRenderer.closeProductionPairedBridge(registryId)
  }, paired.id)
})
