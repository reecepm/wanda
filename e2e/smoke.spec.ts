// -----------------------------------------------------------------------------
// Smoke test: the packaged Electron app boots, the renderer attaches,
// `window.wanda` exposes the preload API, and the WS transport reaches
// `connected` (sys:hello handshake succeeded end-to-end). Any failure here
// means the whole E2E stack is busted — catches protocol drift in <5 s
// instead of waiting minutes through the paired suites.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

test('Wanda boots and exposes the preload API', async ({ wanda }) => {
  expect(wanda.mainWindow.url()).toMatch(/^(file:|http:)/)

  const info = await wanda.localServerInfo()
  expect(info).not.toBeNull()
  expect(info!.port).toBeGreaterThan(0)
  expect(info!.serverId.length).toBeGreaterThan(0)
  expect(typeof info!.listenHost).toBe('string')
})

test('local workspace.list over the preload RPC returns an array', async ({ wanda }) => {
  const workspaces = await wanda.mainWindow.evaluate(async () => {
    type WandaAPI = {
      rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
    }
    const w = window as unknown as { wanda: WandaAPI }
    return await w.wanda.rpc.call(['workspace', 'list'], {})
  })
  expect(Array.isArray(workspaces)).toBe(true)
})

test('WS transport completes the sys:hello handshake and reaches "connected"', async ({ wanda }) => {
  // Wait for the `app.onConnectionStatus` subscription to emit 'connected'.
  // The transport replays the current status on subscribe so a listener
  // attached after the handshake completes still sees it. A broken
  // handshake (malformed sys:hello, unsupported version, etc.) leaves the
  // transport stuck on 'reconnecting' forever — the 5s cap makes that
  // fail loudly here instead of silently in downstream specs.
  const reached = await wanda.mainWindow.evaluate(async () => {
    type WandaAPI = {
      app: {
        onConnectionStatus: (cb: (status: string) => void) => () => void
      }
    }
    const w = window as unknown as { wanda: WandaAPI }
    return await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000)
      const off = w.wanda.app.onConnectionStatus((status) => {
        if (status === 'connected') {
          clearTimeout(timeout)
          off()
          resolve(true)
        }
      })
    })
  })
  expect(reached).toBe(true)
})

test('WS transport relays a server broadcast to the renderer (round-trip)', async ({ wanda }) => {
  // Subscribe to `orpc:invalidate`, trigger a mutation that emits one, and
  // expect the envelope to come back over WS within 2s. Verifies the full
  // pipeline: hello → client `ready` → server broadcasts → gateway fan-out
  // → preload decodes → subscriber fires.
  const received = await wanda.mainWindow.evaluate(async () => {
    type WandaAPI = {
      orpc: { onInvalidate: (cb: (namespace: string, method: string) => void) => () => void }
      rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
    }
    const w = window as unknown as { wanda: WandaAPI }
    const seen: Array<{ namespace: string; method: string }> = []
    const off = w.wanda.orpc.onInvalidate((namespace, method) => {
      seen.push({ namespace, method })
    })
    try {
      await w.wanda.rpc.call(['workspace', 'create'], {
        name: 'smoke-roundtrip',
        cwd: '/tmp/smoke-roundtrip',
      })
      const deadline = Date.now() + 2000
      while (Date.now() < deadline) {
        if (seen.some((e) => e.namespace === 'workspace' && e.method === 'create')) break
        await new Promise((r) => setTimeout(r, 20))
      }
    } finally {
      off()
    }
    return seen
  })
  expect(received.some((e) => e.namespace === 'workspace' && e.method === 'create')).toBe(true)
})
