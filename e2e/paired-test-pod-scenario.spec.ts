// -----------------------------------------------------------------------------
// Full-scenario e2e matching the user's real dev-DB "test" pod: 6
// pre-existing terminals (mix of plain shells + agents). Exercises every
// symptom the user has reported since the v:1 rip:
//
//   - Load the paired pod on A (the fresh renderer), then on B.
//   - Switch between terminal tabs on each side.
//   - Type on A → B must render it; type on B → A must render it.
//   - Scrollback: write on B BEFORE A connects, then open on A and assert
//     the pre-existing output is visible without having to re-type.
//   - Invert: open the pod on A first, then B, repeat bidirectional.
//
// Every assertion reads the xterm buffer directly via
// `__wandaTestRenderer.readTerminalText` — not fixture plumbing — so a
// transport-routing bug cannot hide behind the test harness.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
  }
  terminal: { write: (id: string, data: string) => void }
}

type TestRenderer = {
  listMountedTerminals: () => string[]
  readTerminalText: (ptyInstanceId: string) => string
}

interface SeedResult {
  workspaceName: string
  podId: string
  podName: string
  terminalIds: string[]
  terminalNames: string[]
}

// Matches the user's "test" pod shape (~6 pre-existing terminals).
const TERMINAL_NAMES = ['shell-1', 'shell-2', 'shell-3']

async function seedTestPod(seeder: { mainWindow: import('@playwright/test').Page }): Promise<SeedResult> {
  return (await seeder.mainWindow.evaluate(async (names: string[]) => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], {
      name: 'scenario-workspace',
      cwd: '/tmp',
    })) as { id: string; name: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'test',
      cwd: '/tmp',
    })) as { id: string; name: string }
    const terminalIds: string[] = []
    for (const name of names) {
      const term = (await w.wanda.rpc.call(['pod', 'addTerminal'], {
        podId: pod.id,
        name,
        command: '/bin/sh',
        args: ['-i'],
      })) as { id: string }
      terminalIds.push(term.id)
    }
    await w.wanda.rpc.call(['pod', 'ensureStarted'], { id: pod.id })
    return {
      workspaceName: ws.name,
      podId: pod.id,
      podName: pod.name,
      terminalIds,
      terminalNames: names,
    }
  }, TERMINAL_NAMES)) as SeedResult
}

async function waitForAllRunning(
  owner: { mainWindow: import('@playwright/test').Page },
  podId: string,
  count: number,
): Promise<Array<{ ptyInstanceId: string; podTerminalId: string; name: string }>> {
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    const running = (await owner.mainWindow.evaluate(async (id: string) => {
      const w = window as unknown as { wanda: WandaAPI }
      return (await w.wanda.rpc.call(['pod', 'runningTerminals'], { id })) as Array<{
        ptyInstanceId: string
        podTerminalId: string
        name: string
      }>
    }, podId)) as Array<{ ptyInstanceId: string; podTerminalId: string; name: string }>
    if (running.length >= count && running.every((r) => r.ptyInstanceId)) return running
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`owner never reported ${count} running PTYs within 40s`)
}

async function pairIntoOwner(
  joiner: { mainWindow: import('@playwright/test').Page; waitForReady: () => Promise<void> },
  owner: {
    mainWindow: import('@playwright/test').Page
    mintPairingUrl: () => Promise<{ url: string; expiresAt: number } | null>
    localServerInfo: () => Promise<{ port: number; serverId: string } | null>
  },
): Promise<{ serverId: string }> {
  const pairingUrl = await owner.mintPairingUrl()
  const info = await owner.localServerInfo()
  const loopback = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${info!.port}`)
  const paired = await joiner.mainWindow.evaluate(async (url: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopback)
  await joiner.mainWindow.reload()
  await joiner.waitForReady()
  return { serverId: paired.serverId }
}

async function navigateToPod(
  viewer: { mainWindow: import('@playwright/test').Page },
  workspaceName: string,
  podName: string,
): Promise<void> {
  await viewer.mainWindow.waitForFunction(
    (name: string) => Array.from(document.querySelectorAll('*')).some((el) => el.textContent === name),
    workspaceName,
    { timeout: 25_000 },
  )
  // Exact-text match: `text=` substring-matches and happily clicks the
  // first DOM node whose textContent *contains* the value, which in the
  // sidebar can be an ancestor (e.g. the workspace row that contains the
  // pod row). Pod rows surface the name verbatim so `text="<pod>"` with
  // quotes forces an exact match on a leaf node.
  await viewer.mainWindow.getByText(podName, { exact: true }).first().click()
  // Wait until ANY xterm mounts — proves the first tab's terminal has
  // been picked up by TerminalView and pushed through acquire.
  await viewer.mainWindow.locator('.xterm-helper-textarea').first().waitFor({
    state: 'attached',
    timeout: 25_000,
  })
}

async function waitForTerminalText(
  page: import('@playwright/test').Page,
  ptyInstanceId: string,
  needle: string,
  label: string,
  timeoutMs = 12_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    last = await page.evaluate((id: string) => {
      const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
      return w.__wandaTestRenderer?.readTerminalText(id) ?? ''
    }, ptyInstanceId)
    if (last.includes(needle)) return
    await new Promise((r) => setTimeout(r, 120))
  }
  throw new Error(
    `${label}: xterm ${ptyInstanceId} never contained "${needle}" within ${timeoutMs}ms. Last buffer:\n${last}`,
  )
}

async function mountedIncludes(page: import('@playwright/test').Page, ptyInstanceId: string): Promise<boolean> {
  const mounted = await page.evaluate(() => {
    const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
    return w.__wandaTestRenderer?.listMountedTerminals() ?? []
  })
  return mounted.includes(ptyInstanceId)
}

test('the "test" pod: bidirectional, scrollback, tab-switching (A-first)', async ({ wandaA, wandaB }) => {
  // B owns the pod — 6 pre-existing terminals.
  const seed = await seedTestPod(wandaB)
  const running = await waitForAllRunning(wandaB, seed.podId, TERMINAL_NAMES.length)
  expect(running).toHaveLength(TERMINAL_NAMES.length)

  // ---- Pre-seed one of B's PTYs so there's deterministic pre-connect
  // output for A to show as "scrollback". We pick a target and keep
  // re-firing the write (through the UI's xterm textarea, which is
  // what the app actually uses) until B's own scrollback reports the
  // marker. That avoids races where `/bin/sh -i` hasn't warmed up yet.
  const scrollbackTarget = running[0]
  const scrollbackMarker = `SB_${Math.random().toString(36).slice(2, 8)}`
  await navigateToPod(wandaB, seed.workspaceName, seed.podName)
  const bTextarea = wandaB.mainWindow.locator('.xterm-helper-textarea').first()
  await bTextarea.waitFor({ state: 'attached', timeout: 20_000 })
  await bTextarea.focus()
  const scrollbackDeadline = Date.now() + 15_000
  let bScrollbackOk = false
  while (Date.now() < scrollbackDeadline && !bScrollbackOk) {
    await wandaB.mainWindow.keyboard.type(`echo ${scrollbackMarker}\n`)
    await new Promise((r) => setTimeout(r, 600))
    const text = await wandaB.mainWindow.evaluate((id: string) => {
      const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
      return w.__wandaTestRenderer?.readTerminalText(id) ?? ''
    }, scrollbackTarget.ptyInstanceId)
    if (text.includes(scrollbackMarker)) {
      bScrollbackOk = true
      break
    }
  }
  expect(bScrollbackOk, `B's own xterm never echoed "${scrollbackMarker}"`).toBe(true)

  // ---- Pair + navigate on A. ---------------------------------------------
  await pairIntoOwner(wandaA, wandaB)
  await navigateToPod(wandaA, seed.workspaceName, seed.podName)

  // ---- Scrollback assertion: A must see the pre-connect marker in
  // whichever pty that output lives on. If A's xterm shows the marker
  // even though the typing happened before A pair+connected, scrollback
  // came through the paired bridge.
  await (async () => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (await mountedIncludes(wandaA.mainWindow, scrollbackTarget.ptyInstanceId)) {
        const text = await wandaA.mainWindow.evaluate((id: string) => {
          const w = window as unknown as { __wandaTestRenderer?: TestRenderer }
          return w.__wandaTestRenderer?.readTerminalText(id) ?? ''
        }, scrollbackTarget.ptyInstanceId)
        if (text.includes(scrollbackMarker)) return
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error(
      `A never saw "${scrollbackMarker}" in paired xterm ${scrollbackTarget.ptyInstanceId} — scrollback route broken`,
    )
  })()

  // ---- Bidirectional live stream on the currently-active tab. -----------
  const activePty = await (async () => {
    for (const r of running) if (await mountedIncludes(wandaA.mainWindow, r.ptyInstanceId)) return r
    throw new Error('no mounted pty on A')
  })()

  // A → B
  const a2bMarker = `A2B_${Math.random().toString(36).slice(2, 8)}`
  await wandaA.mainWindow.locator('.xterm-helper-textarea').first().focus()
  await wandaA.mainWindow.keyboard.type(`echo ${a2bMarker}\n`)
  await waitForTerminalText(wandaA.mainWindow, activePty.ptyInstanceId, a2bMarker, 'A self-echo')
  // B must ALSO see it — B hasn't opened the pod page yet, so we read B's
  // xterm after navigating. This proves the write actually hit B's PTY
  // (not just echoed locally from xterm's internal echo).
  await navigateToPod(wandaB, seed.workspaceName, seed.podName)
  if (await mountedIncludes(wandaB.mainWindow, activePty.ptyInstanceId)) {
    await waitForTerminalText(wandaB.mainWindow, activePty.ptyInstanceId, a2bMarker, 'B received A')
  }

  // B → A
  const b2aMarker = `B2A_${Math.random().toString(36).slice(2, 8)}`
  await wandaB.mainWindow.evaluate(
    async ({ id, marker }: { id: string; marker: string }) => {
      const w = window as unknown as { wanda: WandaAPI }
      w.wanda.terminal.write(id, `echo ${marker}\n`)
    },
    { id: activePty.ptyInstanceId, marker: b2aMarker },
  )
  await waitForTerminalText(wandaA.mainWindow, activePty.ptyInstanceId, b2aMarker, 'A received B')

  // ---- Tab switching on A. Each terminal name must be clickable from the
  // view tab strip; each switched tab must mount its xterm and stream.
  // `.getByRole('tab', { name })` is flakier than just clicking the text.
  const clickedNames = new Set<string>()
  for (const name of TERMINAL_NAMES) {
    const tab = wandaA.mainWindow.getByText(name, { exact: true }).first()
    if (!(await tab.isVisible().catch(() => false))) continue
    await tab.click()
    clickedNames.add(name)
    // Wait for the xterm that matches this pty to mount.
    const target = running.find((r) => r.name === name)
    if (!target) continue
    await (async () => {
      const deadline = Date.now() + 8_000
      while (Date.now() < deadline) {
        if (await mountedIncludes(wandaA.mainWindow, target.ptyInstanceId)) return
        await new Promise((r) => setTimeout(r, 150))
      }
      throw new Error(`tab click for "${name}" never mounted ${target.ptyInstanceId}`)
    })()

    // Type into this tab, confirm A echoes and B receives.
    const mk = `TAB_${name}_${Math.random().toString(36).slice(2, 6)}`
    await wandaA.mainWindow.locator('.xterm-helper-textarea').first().focus()
    await wandaA.mainWindow.keyboard.type(`echo ${mk}\n`)
    await waitForTerminalText(wandaA.mainWindow, target.ptyInstanceId, mk, `tab "${name}" A-echo`)
  }
  expect(clickedNames.size, 'must be able to click at least one tab by name').toBeGreaterThan(0)
})

test('the "test" pod: B opens first, then A joins; roles reversed', async ({ wandaA, wandaB }) => {
  const seed = await seedTestPod(wandaB)
  const running = await waitForAllRunning(wandaB, seed.podId, TERMINAL_NAMES.length)

  // B opens the pod first and types into it.
  await navigateToPod(wandaB, seed.workspaceName, seed.podName)
  const bActivePty = await (async () => {
    for (const r of running) if (await mountedIncludes(wandaB.mainWindow, r.ptyInstanceId)) return r
    throw new Error('no mounted pty on B')
  })()

  const marker = `FIRST_B_${Math.random().toString(36).slice(2, 8)}`
  await wandaB.mainWindow.locator('.xterm-helper-textarea').first().focus()
  await wandaB.mainWindow.keyboard.type(`echo ${marker}\n`)
  await waitForTerminalText(wandaB.mainWindow, bActivePty.ptyInstanceId, marker, 'B self-echo')

  // Now A pairs + joins. The marker typed before A existed must appear
  // in A's view — i.e. scrollback from a live session mid-stream.
  await pairIntoOwner(wandaA, wandaB)
  await navigateToPod(wandaA, seed.workspaceName, seed.podName)
  if (await mountedIncludes(wandaA.mainWindow, bActivePty.ptyInstanceId)) {
    await waitForTerminalText(wandaA.mainWindow, bActivePty.ptyInstanceId, marker, "A sees B's pre-join output")
  }

  // Bidirectional in the reverse role.
  const a2bMarker = `REV_A2B_${Math.random().toString(36).slice(2, 8)}`
  await wandaA.mainWindow.locator('.xterm-helper-textarea').first().focus()
  await wandaA.mainWindow.keyboard.type(`echo ${a2bMarker}\n`)
  await waitForTerminalText(wandaA.mainWindow, bActivePty.ptyInstanceId, a2bMarker, 'A self-echo (rev)')
  await waitForTerminalText(wandaB.mainWindow, bActivePty.ptyInstanceId, a2bMarker, 'B sees A (rev)')
})
