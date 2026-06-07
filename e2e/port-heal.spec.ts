// -----------------------------------------------------------------------------
// Paired-server port heal test.
//
// The real-world scenario this catches: Wanda on the Mac mini restarts,
// gets a different ephemeral port → the laptop's stored baseUrl is now
// stale and every RPC against it returns ERR_CONNECTION_REFUSED. Before
// the fix, the user had to manually unpair + re-pair every time. After
// the fix, the client registry's `probeAndHeal` picks a known stable
// port, verifies the same serverId responds, rewrites paired_servers
// .base_url, and the UI transparently reconnects.
// -----------------------------------------------------------------------------

import { test as baseTest, expect } from '@playwright/test'
import { launchWanda, type WandaInstance } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
    list: () => Promise<Array<{ id: string; serverId: string; baseUrl: string }>>
    probeAndHeal: (id: string) => Promise<string | null>
    getSessionToken: (id: string) => Promise<string | null>
  }
}
type Hooks = {
  pairedClient: (opts: { baseUrl: string; token: string; path: string[]; input: unknown }) => Promise<unknown>
}

// Playwright's default fixture supplies A + B bound to 0.0.0.0 with
// ephemeral ports (WANDA_PORT defaults to 0 there). For this test we
// want full control: B is explicitly booted on PORT_A, shut down, and
// restarted on PORT_B — each time with the same serverId + userData so
// auth persists. `baseTest` gives us the raw runner without the
// auto-fixture so we manage instances ourselves.

const test = baseTest

async function launchB(opts: { port: number; userDataDir?: string; serverId?: string }): Promise<WandaInstance> {
  return launchWanda({
    label: 'B',
    listenHost: '0.0.0.0',
    env: {
      WANDA_PORT: String(opts.port),
      WANDA_SERVER_ID: opts.serverId ?? 'stable-server-id-for-heal-test',
      ...(opts.userDataDir != null ? { WANDA_USER_DATA_DIR: opts.userDataDir } : {}),
    },
  })
}

test("A's paired inventory auto-heals when B restarts on a new port", async () => {
  const wandaA = await launchWanda({ label: 'A', listenHost: '0.0.0.0', env: { WANDA_PORT: '0' } })
  await wandaA.waitForReady()

  // Boot B on a specific port with a stable serverId so both attempts
  // appear as the same logical machine.
  const wandaB1 = await launchB({ port: 19876 })
  await wandaB1.waitForReady()
  const infoB1 = await wandaB1.localServerInfo()
  expect(infoB1!.port).toBe(19876)
  const bUserDataDir = wandaB1.userDataDir
  const bServerId = infoB1!.serverId

  // Seed a workspace on B so A has something to see.
  await wandaB1.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.rpc.call(['workspace', 'create'], { name: 'heal-ws', cwd: '/tmp' })
  })

  // A pairs with B on port 19876. Use loopback since A binds to 0.0.0.0
  // locally — the pair URL's hostname doesn't matter, just need the
  // right port.
  const pairingUrl = await wandaB1.mintPairingUrl()
  const loopback1 = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB1!.port}`)
  const paired = await wandaA.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback1)
  expect(paired.serverId).toBe(bServerId)
  expect(paired.baseUrl).toMatch(/:19876$/)

  // Sanity: paired RPC works on the original port.
  const workspacesBefore = (await wandaA.mainWindow.evaluate(
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
    { baseUrl: `http://127.0.0.1:19876`, registryId: paired.id },
  )) as Array<{ name: string }>
  expect(workspacesBefore.some((w) => w.name === 'heal-ws')).toBe(true)

  // --------------------------------------------------------------------
  // Restart B on a DIFFERENT port but the SAME userData + serverId, so
  // its SQLite auth sessions persist and A's session token stays valid.
  // --------------------------------------------------------------------
  await wandaB1.app.close()
  const wandaB2 = await launchB({
    port: 9876, // The canonical Wanda stable network port — what probeAndHeal tries first.
    userDataDir: bUserDataDir,
    serverId: bServerId,
  })
  await wandaB2.waitForReady()
  const infoB2 = await wandaB2.localServerInfo()
  expect(infoB2!.port).toBe(9876)
  expect(infoB2!.serverId).toBe(bServerId)

  try {
    // A's stored baseUrl still points at :19876 and ERR_CONNECTION_REFUSED.
    // probeAndHeal should discover the new port (9876) and update the row.
    const healed = await wandaA.mainWindow.evaluate(async (registryId: string) => {
      const w = window as unknown as { wanda: WandaAPI }
      return await w.wanda.servers.probeAndHeal(registryId)
    }, paired.id)
    expect(healed).toMatch(/:9876$/)

    // The registry's list now reflects the updated baseUrl.
    const listAfter = (await wandaA.mainWindow.evaluate(async () => {
      const w = window as unknown as { wanda: WandaAPI }
      return await w.wanda.servers.list()
    })) as Array<{ id: string; baseUrl: string }>
    const row = listAfter.find((r) => r.id === paired.id)
    expect(row?.baseUrl).toMatch(/:9876$/)

    // And a fresh paired RPC through the new URL succeeds — same
    // session token, same workspace visible. That's the "user never
    // had to re-pair" guarantee.
    const workspacesAfter = (await wandaA.mainWindow.evaluate(
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
      { baseUrl: `http://127.0.0.1:9876`, registryId: paired.id },
    )) as Array<{ name: string }>
    expect(workspacesAfter.some((w) => w.name === 'heal-ws')).toBe(true)
  } finally {
    await wandaB2.dispose()
    await wandaA.dispose()
  }
})
