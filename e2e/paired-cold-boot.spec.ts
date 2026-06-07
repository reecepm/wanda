// -----------------------------------------------------------------------------
// Paired pod survives a cold restart on BOTH sides.
//
// Every other paired-pod spec pairs within the same process lifetime, so a
// failure in session-token persistence (AuthStore hydration, client-side
// SecretStore, or registry DB schema) would pass every other test and still
// break this flow.
//
// Strategy: launch A + B with fresh userData, pair, dispose both, relaunch
// with the SAME userData dirs (no `mainWindow.reload()` — an honest cold
// boot), navigate to the paired pod, and assert the pod page renders.
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
  localServer: {
    info: () => Promise<{ port: number; serverId: string; listenHost: string; hostname: string } | null>
    issuePairingUrl: () => Promise<{ url: string; expiresAt: number } | null>
  }
}

test('paired pod page renders after both sides restart with same userData', async () => {
  const userDataA = mkdtempSync(join(tmpdir(), 'wanda-e2e-coldboot-A-'))
  const userDataB = mkdtempSync(join(tmpdir(), 'wanda-e2e-coldboot-B-'))

  // B binds to a dedicated fixed port so A's cached baseUrl still points
  // at a listening socket after B's cold restart. Matches the production
  // default (`WANDA_PORT=9876`) but offset so parallel test runs don't
  // collide with real dev instances.
  const B_FIXED_PORT = String(19876 + Math.floor(Math.random() * 1000))

  try {
    // ---- Session 1: pair A → B, seed a pod with a terminal, dispose. -----
    const a1 = await launchWanda({
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
      await a1.waitForReady()
      await b1.waitForReady()

      const seed = await b1.mainWindow.evaluate(async () => {
        const w = window as unknown as { wanda: WandaAPI }
        const ws = (await w.wanda.rpc.call(['workspace', 'create'], {
          name: 'coldboot-ws',
          cwd: '/tmp',
        })) as { id: string; name: string }
        const pod = (await w.wanda.rpc.call(['pod', 'create'], {
          workspaceId: ws.id,
          name: 'coldboot-pod',
          cwd: '/tmp',
        })) as { id: string; name: string }
        await w.wanda.rpc.call(['pod', 'addTerminal'], {
          podId: pod.id,
          name: 'shell',
          command: '/bin/sh',
          args: ['-i'],
        })
        return { workspaceName: ws.name, podName: pod.name }
      })

      const pairingUrl = await b1.mintPairingUrl()
      const infoB1 = await b1.localServerInfo()
      const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB1!.port}`)
      const paired = await a1.mainWindow.evaluate(async (url: string) => {
        const w = window as unknown as { wanda: WandaAPI }
        return await w.wanda.servers.pair(url)
      }, loopback)
      expect(paired.serverId).toBe(infoB1!.serverId)

      // Hand off the named entities so we can look them up after restart.
      ;(a1 as unknown as { __seed: unknown }).__seed = seed
    } finally {
      await a1.dispose()
      await b1.dispose()
    }

    // ---- Session 2: cold boot both with the same userData. ---------------
    const a2 = await launchWanda({
      label: 'A2',
      listenHost: '0.0.0.0',
      env: { WANDA_PORT: '0' },
      reuseUserDataDir: userDataA,
    })
    const b2 = await launchWanda({
      label: 'B2',
      listenHost: '0.0.0.0',
      env: { WANDA_PORT: B_FIXED_PORT },
      reuseUserDataDir: userDataB,
    })
    try {
      await a2.waitForReady()
      await b2.waitForReady()

      // Fetch the seeded names from B's persisted DB (not the previous
      // fixture variable — B's process is new).
      const { workspaceName, podName } = await b2.mainWindow.evaluate(async () => {
        const w = window as unknown as { wanda: WandaAPI }
        const list = (await w.wanda.rpc.call(['workspace', 'list'], {})) as Array<{ id: string; name: string }>
        const ws = list.find((x) => x.name === 'coldboot-ws')!
        const pods = (await w.wanda.rpc.call(['pod', 'list'], { workspaceId: ws.id })) as Array<{
          id: string
          name: string
        }>
        return { workspaceName: ws.name, podName: pods[0].name }
      })
      expect(workspaceName).toBe('coldboot-ws')
      expect(podName).toBe('coldboot-pod')

      // Without a `mainWindow.reload()`, the paired workspace must appear
      // in A's sidebar on its own within a reasonable window. If this
      // waitForFunction hits timeout, sidebar fan-out is broken after a
      // cold boot.
      await a2.mainWindow
        .locator(`[data-wanda-workspace-name="${workspaceName}"]`)
        .first()
        .waitFor({ state: 'attached', timeout: 25_000 })
      await a2.mainWindow.locator(`[data-wanda-pod-row][data-wanda-pod-name="${podName}"]`).first().click()

      // Full pod-page render must succeed on the paired side, same
      // assertions as `paired-pod-renders.spec.ts`.
      await a2.mainWindow.waitForSelector('[data-wanda-pod-page][data-wanda-pod-kind="remote"]', {
        timeout: 20_000,
        state: 'attached',
      })
      const activeView = a2.mainWindow.locator('[data-wanda-active-view]')
      await activeView.waitFor({ state: 'attached', timeout: 15_000 })
      const viewType = await activeView.first().getAttribute('data-wanda-view-type')
      expect(viewType).toBeTruthy()
      expect(viewType).not.toBe('split-pane')
      await a2.mainWindow.locator('.xterm-helper-textarea').first().waitFor({
        state: 'attached',
        timeout: 20_000,
      })
    } finally {
      await a2.dispose()
      await b2.dispose()
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
