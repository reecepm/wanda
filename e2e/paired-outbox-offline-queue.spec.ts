// -----------------------------------------------------------------------------
// Paired-mutation outbox: offline queue + reconnect drain.
//
// Pair A → B. Take B offline. From A, fire a paired mutation through the
// outbox — it must fail the initial attempt, persist in the queue, and
// NOT silently disappear. Bring B back up on the same userData (so
// session token + serverId survive). Trigger a drain; the mutation must
// apply to B. Guards the "user fires a workspace.create while the
// paired server is flapping and it vanishes forever" regression.
// -----------------------------------------------------------------------------

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, launchWanda, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
  }
  outbox: {
    enqueueAndFire: (
      registryId: string,
      method: string,
      input: unknown,
    ) => Promise<{ ok: boolean; outboxId: string; result: unknown; error: string | null }>
    drain: (registryId: string) => Promise<Array<{ entryId: string; ok: boolean; error: string | null }>>
    list: (registryId?: string) => Promise<
      Array<{
        id: string
        registryId: string
        method: string
        input: unknown
        createdAt: number
        retries: number
        lastError: string | null
      }>
    >
  }
}

test('paired mutation enqueues while B is offline, drains on B relaunch', async () => {
  const userDataA = mkdtempSync(join(tmpdir(), 'wanda-e2e-outbox-A-'))
  const userDataB = mkdtempSync(join(tmpdir(), 'wanda-e2e-outbox-B-'))

  // B binds to a fixed port so its baseUrl survives a dispose/relaunch.
  const B_FIXED_PORT = String(29876 + Math.floor(Math.random() * 1000))

  try {
    // ---- Session 1: pair A → B, grab the registryId. -----------------------
    const a = await launchWanda({
      label: 'A',
      listenHost: '0.0.0.0',
      env: { WANDA_PORT: '0' },
      reuseUserDataDir: userDataA,
    })
    const b1 = await launchWanda({
      label: 'B',
      listenHost: '0.0.0.0',
      env: { WANDA_PORT: B_FIXED_PORT },
      reuseUserDataDir: userDataB,
    })

    try {
      await a.waitForReady()
      await b1.waitForReady()

      const pairingUrl = await b1.mintPairingUrl()
      const infoB1 = await b1.localServerInfo()
      const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB1!.port}`)
      const paired = await a.mainWindow.evaluate(async (url: string) => {
        const w = window as unknown as { wanda: WandaAPI }
        return await w.wanda.servers.pair(url)
      }, loopback)
      const registryId = paired.id
      expect(paired.serverId).toBe(infoB1!.serverId)

      // ---- Take B offline. -----------------------------------------------
      await b1.dispose()

      // ---- From A, fire a paired mutation via the outbox while B is down.
      // It must fail the initial fire (transient network error) AND land
      // in the outbox (not disappear).
      const fireWhileDown = await a.mainWindow.evaluate(
        async ({ registryId }: { registryId: string }) => {
          const w = window as unknown as { wanda: WandaAPI }
          return await w.wanda.outbox.enqueueAndFire(registryId, 'workspace.create', {
            name: 'outbox-queued-ws',
            cwd: '/tmp/outbox-queued-ws',
          })
        },
        { registryId },
      )
      expect(
        fireWhileDown.ok,
        `expected offline fire to fail, got ok=true result=${JSON.stringify(fireWhileDown.result)}`,
      ).toBe(false)
      expect(fireWhileDown.error, 'offline fire must surface an error').toBeTruthy()
      expect(fireWhileDown.outboxId, 'offline fire must return a persisted outbox id').toBeTruthy()

      const pendingWhileDown = await a.mainWindow.evaluate(
        async ({ registryId }: { registryId: string }) => {
          const w = window as unknown as { wanda: WandaAPI }
          return await w.wanda.outbox.list(registryId)
        },
        { registryId },
      )
      expect(
        pendingWhileDown.length,
        `expected 1 pending outbox entry while B is down, got ${pendingWhileDown.length}. fireWhileDown.error=${fireWhileDown.error}`,
      ).toBe(1)
      expect(pendingWhileDown[0].method).toBe('workspace.create')
      expect(pendingWhileDown[0].registryId).toBe(registryId)

      // ---- Bring B back on the same port + userData. Session token must
      //      still be valid because B persisted its auth_sessions row.
      const b2 = await launchWanda({
        label: 'B2',
        listenHost: '0.0.0.0',
        env: { WANDA_PORT: B_FIXED_PORT },
        reuseUserDataDir: userDataB,
      })

      try {
        await b2.waitForReady()
        const infoB2 = await b2.localServerInfo()
        expect(infoB2!.port).toBe(Number(B_FIXED_PORT))
        expect(infoB2!.serverId).toBe(infoB1!.serverId)

        // ---- Drain the outbox. In production this is triggered by the
        //      paired-bridge onReconnect; here we call it explicitly so
        //      the test doesn't depend on the renderer opening a paired
        //      pod. The underlying code path is identical.
        const drainResult = await a.mainWindow.evaluate(
          async ({ registryId }: { registryId: string }) => {
            const w = window as unknown as { wanda: WandaAPI }
            return await w.wanda.outbox.drain(registryId)
          },
          { registryId },
        )
        expect(drainResult.length, 'drain must produce one result per pending entry').toBe(1)
        expect(drainResult[0].ok, `drain failed: ${drainResult[0].error ?? ''}`).toBe(true)

        // ---- Outbox should now be empty for this registry. ---------------
        const pendingAfterDrain = await a.mainWindow.evaluate(
          async ({ registryId }: { registryId: string }) => {
            const w = window as unknown as { wanda: WandaAPI }
            return await w.wanda.outbox.list(registryId)
          },
          { registryId },
        )
        expect(
          pendingAfterDrain.length,
          `outbox should be empty after successful drain, got ${pendingAfterDrain.length}`,
        ).toBe(0)

        // ---- B must actually have the workspace now. ---------------------
        const workspacesOnB = (await b2.mainWindow.evaluate(async () => {
          const w = window as unknown as { wanda: WandaAPI }
          return (await w.wanda.rpc.call(['workspace', 'list'], {})) as Array<{ name: string }>
        })) as Array<{ name: string }>
        expect(
          workspacesOnB.some((w) => w.name === 'outbox-queued-ws'),
          `B should have the workspace after drain, got names=${workspacesOnB.map((w) => w.name).join(',')}`,
        ).toBe(true)
      } finally {
        await b2.dispose()
      }
    } finally {
      await a.dispose()
    }
  } finally {
    try {
      rmSync(userDataA, { recursive: true, force: true })
      rmSync(userDataB, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})
