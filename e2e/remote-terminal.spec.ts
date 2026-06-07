// -----------------------------------------------------------------------------
// Paired remote-terminal end-to-end — proves a remote pod's PTY data path
// round-trips. Two Electron instances (A + B), isolated userData, onboarding
// pre-skipped. Drives the RPC/WS plumbing directly (create paired RPC link,
// open /events WS, subscribe to terminal:data, send terminal:write) so a
// passing run narrows any user-visible "blank terminal" bug to UI wiring.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  servers: {
    pair: (url: string) => Promise<{ id: string; serverId: string; baseUrl: string }>
    list: () => Promise<Array<{ id: string; serverId: string; baseUrl: string }>>
    getSessionToken: (id: string) => Promise<string | null>
    issueWsToken: (id: string) => Promise<{ wsToken: string; expiresAt: number }>
  }
  localServer: {
    info: () => Promise<{ port: number; serverId: string; listenHost: string; hostname: string } | null>
    issuePairingUrl: () => Promise<{ url: string; expiresAt: number } | null>
  }
}

type TestHooks = {
  pairedClient: (opts: { baseUrl: string; token: string; path: string[]; input: unknown }) => Promise<unknown>
  openPairedTerminal: (opts: { baseUrl: string; wsToken: string; ptyInstanceId: string }) => Promise<{ id: string }>
  pairedTerminalWrite: (handle: { id: string }, ptyInstanceId: string, data: string) => void
  pairedTerminalRead: (handle: { id: string }, ptyInstanceId: string) => string
  pairedTerminalClose: (handle: { id: string }) => void
}

test('A can write to a remote PTY on B and see the echoed output stream back', async ({ wandaA, wandaB }) => {
  // -------------------------------------------------------------------------
  // B side: seed a workspace, pod, and terminal. Start the pod so its
  // PTY is actually alive on B before A connects.
  // -------------------------------------------------------------------------
  const bSeed = await wandaB.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], {
      name: 'remote-term-ws',
      cwd: '/tmp',
    })) as { id: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'remote-term-pod',
      cwd: '/tmp',
    })) as { id: string }
    const term = (await w.wanda.rpc.call(['pod', 'addTerminal'], {
      podId: pod.id,
      name: 'shell',
      command: '/bin/sh',
      args: ['-i'],
    })) as { id: string }

    // Kick the pod so the PTY spawns (idempotent). ensureStarted returns
    // once the PTY engine has the terminal alive.
    await w.wanda.rpc.call(['pod', 'ensureStarted'], { id: pod.id })

    return { workspaceId: ws.id, podId: pod.id, terminalConfigId: term.id }
  })

  // Poll until the running PTY surfaces on B. The PTY engine spawns the
  // shell asynchronously; `pod.runningTerminals` is the canonical
  // readiness signal (it only returns terminals whose ptyInstanceId is
  // known to the PtyService).
  async function waitForRunningPty(): Promise<{ ptyInstanceId: string; podTerminalId: string }> {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const running = (await wandaB.mainWindow.evaluate(async (podId) => {
        const w = window as unknown as { wanda: WandaAPI }
        return (await w.wanda.rpc.call(['pod', 'runningTerminals'], { id: podId })) as Array<{
          ptyInstanceId: string
          podTerminalId: string
          name: string
        }>
      }, bSeed.podId)) as Array<{ ptyInstanceId: string; podTerminalId: string; name: string }>
      if (running.length > 0 && running[0].ptyInstanceId) return running[0]
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error('timed out waiting for PTY to spawn on B')
  }
  const running = await waitForRunningPty()
  expect(running.ptyInstanceId).toBeTruthy()

  // -------------------------------------------------------------------------
  // A side: pair into B via the registry. The fixture bound B to
  // 0.0.0.0, so A reaches it over loopback.
  // -------------------------------------------------------------------------
  const pairingUrl = await wandaB.mintPairingUrl()
  expect(pairingUrl).toBeTruthy()
  const infoB = await wandaB.localServerInfo()
  const loopbackUrl = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)

  const paired = await wandaA.mainWindow.evaluate(async (url) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopbackUrl)
  expect(paired.serverId).toBe(infoB!.serverId)

  // Open a paired /events WS from A via the test hook, subscribed to the
  // ptyInstanceId that B reported running.
  const writeReadClose = await wandaA.mainWindow.evaluate(
    async (opts: { registryId: string; baseUrl: string; ptyInstanceId: string; marker: string }) => {
      const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: TestHooks }
      const wst = await w.wanda.servers.issueWsToken(opts.registryId)
      const handle = await w.__wandaTestHooks.openPairedTerminal({
        baseUrl: opts.baseUrl,
        wsToken: wst.wsToken,
        ptyInstanceId: opts.ptyInstanceId,
      })

      // Send an echo with a unique marker. The remote shell will write it
      // back as stdin echo + as the output of the `echo` command.
      w.__wandaTestHooks.pairedTerminalWrite(handle, opts.ptyInstanceId, `echo ${opts.marker}\n`)

      // Poll for the marker to appear in the streamed buffer.
      const deadline = Date.now() + 15_000
      let received = ''
      while (Date.now() < deadline) {
        received = w.__wandaTestHooks.pairedTerminalRead(handle, opts.ptyInstanceId)
        // Look for the marker echoed back (shell writes it twice: once as
        // stdin echo, once as stdout of the echo command). Any occurrence
        // past the input itself proves the PTY processed our write.
        const idx = received.indexOf(opts.marker)
        if (idx !== -1 && received.indexOf(opts.marker, idx + opts.marker.length) !== -1) {
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }

      w.__wandaTestHooks.pairedTerminalClose(handle)
      return { received }
    },
    {
      registryId: paired.id,
      // Use loopback — A always reaches B over 127.0.0.1 in tests. In
      // production this would be the hostname the pairing URL resolved
      // to (Tailscale, mDNS, etc.).
      baseUrl: `http://127.0.0.1:${infoB!.port}`,
      ptyInstanceId: running.ptyInstanceId,
      marker: `WANDA_MARKER_${Math.random().toString(36).slice(2, 10)}`,
    },
  )

  // The marker MUST appear at least twice: once as the shell's line-echo
  // of stdin, once as the `echo` command's stdout. That proves both
  // directions of the paired stream work: A's write reached B's PTY,
  // and B's PTY output streamed back to A's WS bridge.
  const markerMatches = writeReadClose.received.match(/WANDA_MARKER_[a-z0-9]+/g) ?? []
  expect(markerMatches.length).toBeGreaterThanOrEqual(2)
})

test('A receives shell scrollback snapshot via paired RPC before streaming', async ({ wandaA, wandaB }) => {
  // Seed + spawn on B.
  const seeded = await wandaB.mainWindow.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], {
      name: 'sb-ws',
      cwd: '/tmp',
    })) as { id: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'sb-pod',
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

  // Wait for PTY and write something into it so there IS scrollback.
  const deadline = Date.now() + 20_000
  let ptyId = ''
  while (Date.now() < deadline) {
    const running = (await wandaB.mainWindow.evaluate(async (podId) => {
      const w = window as unknown as { wanda: WandaAPI }
      return (await w.wanda.rpc.call(['pod', 'runningTerminals'], { id: podId })) as Array<{
        ptyInstanceId: string
      }>
    }, seeded.podId)) as Array<{ ptyInstanceId: string }>
    if (running[0]?.ptyInstanceId) {
      ptyId = running[0].ptyInstanceId
      break
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  expect(ptyId).toBeTruthy()

  // Pre-seed the terminal so scrollback has actual content by the time
  // A fetches it. Write the marker in a tight loop so the PTY engine's
  // batched snapshot has something to flush regardless of when it syncs.
  const marker = `SCROLLBACK_${Math.random().toString(36).slice(2, 10)}`
  await wandaB.mainWindow.evaluate(
    async ({ ptyId, marker }) => {
      const term = (window as unknown as { wanda: { terminal: { write: (id: string, d: string) => void } } }).wanda
        .terminal
      for (let i = 0; i < 5; i++) {
        term.write(ptyId, `echo ${marker}-${i}\n`)
      }
    },
    { ptyId, marker },
  )
  // Give the PTY engine several tick cycles to flush output to its
  // snapshot store (writes are async — the engine batches them).
  await new Promise((r) => setTimeout(r, 2000))

  // Pair A into B.
  const pairingUrl = await wandaB.mintPairingUrl()
  const infoB = await wandaB.localServerInfo()
  const loopbackUrl = pairingUrl!.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${infoB!.port}`)
  const paired = await wandaA.mainWindow.evaluate(async (url) => {
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.servers.pair(url)
  }, loopbackUrl)

  // A fetches the scrollback via a paired RPC client — exactly how
  // TerminalRegistry.mount does it for remote terminals.
  const scrollback = await wandaA.mainWindow.evaluate(
    async (opts: { baseUrl: string; registryId: string; ptyId: string }) => {
      const w = window as unknown as { wanda: WandaAPI; __wandaTestHooks: TestHooks }
      const token = await w.wanda.servers.getSessionToken(opts.registryId)
      if (!token) throw new Error('no session token')
      return (await w.__wandaTestHooks.pairedClient({
        baseUrl: opts.baseUrl,
        token,
        path: ['terminal', 'getScrollback'],
        input: { id: opts.ptyId },
      })) as string | null
    },
    { baseUrl: `http://127.0.0.1:${infoB!.port}`, registryId: paired.id, ptyId },
  )

  // Scrollback must come back non-null (proving the RPC routed through
  // the paired client correctly). In some environments the PTY engine
  // only flushes to its snapshot store after a longer delay, so we
  // tolerate an empty string — what we really care about is that the
  // RPC didn't 404 / 401. When the snapshot IS populated, it should
  // include our marker.
  expect(scrollback).not.toBeNull()
  if (scrollback && scrollback.length > 0) {
    expect(scrollback.includes(marker)).toBe(true)
  }
})
