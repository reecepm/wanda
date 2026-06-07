// -----------------------------------------------------------------------------
// Subprocess-mode smoke test for Phase 4.
//
// Spawns electron/server/bin.ts as a real Node child process via
// createSubprocessHandle(), reads the stdout handshake, then exercises the
// HTTP oRPC client + WebSocket events channel. Validates:
//
//   1. The subprocess boots and emits a JSON handshake on stdout.
//   2. The returned oRPC client can round-trip an RPC call against the child.
//   3. Mutations through that client generate `orpc:invalidate` broadcasts
//      that reach the parent via the WS bridge.
//   4. The handle's convenience methods (getCloseToTray, getUnresolvedCounts)
//      work over the HTTP transport.
//   5. Shutdown (handle.stop()) cleanly terminates the child.
//
// This is the acid test for the whole Phase 4 design: if this passes, the
// shell ↔ server boundary is real, not theoretical.
// -----------------------------------------------------------------------------

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { __getSubprocessRuntimeStateForTest, createSubprocessHandle, type ShellServerHandle } from '../server-handle'

describe('subprocess server handle', () => {
  let scratch: string
  let handle: ShellServerHandle
  const receivedBroadcasts: Array<{ channel: string; args: ReadonlyArray<unknown> }> = []

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'wanda-subproc-'))
    mkdirSync(join(scratch, 'data'), { recursive: true })

    const dataDir = join(scratch, 'data')
    const appRoot = process.cwd()

    // The server entry is the compiled electron-vite output. This test
    // REQUIRES `bun run build` (or `electron-vite build`) to have run first.
    // Dev-only spawning via tsx blows up on @xterm/headless's CJS/ESM
    // interop — only the Rollup-bundled output handles that correctly.
    const serverEntry = join(appRoot, 'out/main/server.js')
    if (!existsSync(serverEntry)) {
      throw new Error(`Server entry not found at ${serverEntry}. ` + 'Run `bunx electron-vite build` before this test.')
    }

    handle = await createSubprocessHandle({
      serverEntry,
      env: {
        ...process.env,
        WANDA_DATA_DIR: dataDir,
        WANDA_USER_DATA_DIR: dataDir,
        WANDA_APP_ROOT: appRoot,
        WANDA_APP_VERSION: '0.0.0-subproc',
        WANDA_DB_PATH: join(dataDir, 'test.db'),
        WANDA_PORT_FILE: join(dataDir, 'mcp-port'),
        WANDA_MIGRATIONS_FOLDER: join(appRoot, 'electron/db/migrations'),
        // Force port 0 so each test run picks its own port.
        WANDA_PORT: '0',
      },
      port: 0,
      onBroadcast: (channel, args) => {
        receivedBroadcasts.push({ channel, args })
      },
    })
  }, 60_000)

  afterAll(async () => {
    if (handle) await handle.stop()
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }, 30_000)

  it('boots in subprocess mode', () => {
    expect(handle.mode).toBe('subprocess')
  })

  it('client.workspace.list returns an empty array over HTTP', async () => {
    const list = await handle.client.workspace.list({})
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBe(0)
  })

  it('getCloseToTray returns a boolean via RPC', async () => {
    const result = await handle.getCloseToTray()
    expect(typeof result).toBe('boolean')
  })

  it('getUnresolvedCounts returns a count via RPC', async () => {
    const counts = await handle.getUnresolvedCounts()
    expect(typeof counts.totalBlocking).toBe('number')
  })

  it('workspace.create fires an orpc:invalidate broadcast to the parent', async () => {
    const beforeCount = receivedBroadcasts.length
    const workspace = await handle.client.workspace.create({
      name: 'subproc smoke workspace',
      cwd: '/tmp',
    })
    expect(typeof workspace.id).toBe('string')

    // Give the WS a moment to deliver.
    await new Promise((r) => setTimeout(r, 200))

    expect(receivedBroadcasts.length).toBeGreaterThan(beforeCount)
    const invalidate = receivedBroadcasts.find(
      (b) => b.channel === 'orpc:invalidate' && b.args[0] === 'workspace' && b.args[1] === 'create',
    )
    expect(invalidate).toBeDefined()
  })

  it('destroyAllPtys is a no-op', () => {
    // Should not throw.
    expect(() => handle.destroyAllPtys()).not.toThrow()
  })

  it('getRunningPodCount returns 0 via countByStatus RPC', async () => {
    const count = await handle.getRunningPodCount()
    expect(count).toBe(0)
  })

  it('connectAndRecover resolves', async () => {
    await expect(handle.connectAndRecover()).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Auto-restart: kill the child and verify the handle transparently recovers.
// Uses its own describe block so the crash noise doesn't bleed into the main
// suite's assertions.
// ---------------------------------------------------------------------------

describe('subprocess handle auto-restart', () => {
  let scratch: string
  let handle: ShellServerHandle
  let onCrashCallCount = 0
  let onRestartCallCount = 0

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'wanda-restart-'))
    mkdirSync(join(scratch, 'data'), { recursive: true })

    const dataDir = join(scratch, 'data')
    const appRoot = process.cwd()
    const serverEntry = join(appRoot, 'out/main/server.js')
    if (!existsSync(serverEntry)) {
      throw new Error(`run \`bunx electron-vite build\` first: missing ${serverEntry}`)
    }

    handle = await createSubprocessHandle({
      serverEntry,
      env: {
        ...process.env,
        WANDA_DATA_DIR: dataDir,
        WANDA_USER_DATA_DIR: dataDir,
        WANDA_APP_ROOT: appRoot,
        WANDA_APP_VERSION: '0.0.0-restart',
        WANDA_DB_PATH: join(dataDir, 'test.db'),
        WANDA_PORT_FILE: join(dataDir, 'mcp-port'),
        WANDA_MIGRATIONS_FOLDER: join(appRoot, 'electron/db/migrations'),
        WANDA_PORT: '0',
      },
      port: 0,
      onBroadcast: () => {},
      onCrash: () => {
        onCrashCallCount += 1
      },
      onRestart: () => {
        onRestartCallCount += 1
      },
    })
  }, 60_000)

  afterAll(async () => {
    if (handle) await handle.stop()
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }, 30_000)

  it('proxy client continues working across a subprocess crash', async () => {
    // Pre-crash sanity check.
    const list1 = await handle.client.workspace.list({})
    expect(Array.isArray(list1)).toBe(true)

    // Reach into the runtime state via the test-only helper and hard-kill
    // the child with SIGKILL (so its own SIGTERM handler doesn't run).
    const state = __getSubprocessRuntimeStateForTest(handle)
    expect(state).toBeDefined()
    const originalChild = state!.conn?.child
    expect(originalChild).toBeDefined()
    const originalPid = originalChild!.pid
    expect(typeof originalPid).toBe('number')

    originalChild!.kill('SIGKILL')

    // Wait for the restart loop to spawn a new subprocess. Poll every 50ms
    // up to 20s so CI variance doesn't flake us out.
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const nowState = __getSubprocessRuntimeStateForTest(handle)
      if (nowState?.conn && nowState.conn.child.pid !== originalPid) break
      await new Promise((r) => setTimeout(r, 50))
    }

    const stateAfter = __getSubprocessRuntimeStateForTest(handle)
    expect(stateAfter?.conn).toBeDefined()
    expect(stateAfter!.conn!.child.pid).not.toBe(originalPid)

    // onCrash fired; onRestart fired.
    expect(onCrashCallCount).toBeGreaterThanOrEqual(1)
    expect(onRestartCallCount).toBeGreaterThanOrEqual(1)

    // The proxy client transparently targets the new child.
    const list2 = await handle.client.workspace.list({})
    expect(Array.isArray(list2)).toBe(true)
  }, 30_000)
})
