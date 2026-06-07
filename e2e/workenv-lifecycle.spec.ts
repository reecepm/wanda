// -----------------------------------------------------------------------------
// Workenv lifecycle — create / start / exec / stop / destroy.
//
// Uses the `wandaFake` fixture which swaps OrbStack/Colima adapters for the
// FakeRuntimeAdapter, so these specs run without any real VM. The RPC
// surface is identical to production; the only difference is that
// `adapter.exec` drains a scripted data buffer instead of spawning a
// subprocess.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
  workenv: {
    onStateChanged: (cb: (id: string, from: string, to: string) => void) => () => void
  }
  terminal: {
    onData: (streamId: string, cb: (data: string) => void) => () => void
    onExit: (streamId: string, cb: (code: number) => void) => () => void
  }
}

interface WorkenvRow {
  id: string
  state: string
  slug: string
  name: string
}

test('workenv full lifecycle: create → start → exec → stop → destroy', async ({ wandaFake }) => {
  const page = wandaFake.mainWindow

  // ---- Create ------------------------------------------------------------
  const { created } = await page.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const created = (await w.wanda.rpc.call(['workenv', 'create'], {
      name: 'e2e-lifecycle',
      slug: 'e2e-lifecycle',
      config: { runtime: 'orbstack', worktreePath: '/tmp/e2e-lifecycle' },
    })) as WorkenvRow
    return { created }
  })
  expect(created.state).toBe('stopped')
  expect(created.slug).toBe('e2e-lifecycle')

  // ---- Start ------------------------------------------------------------
  // `start()` transitions stopped → starting → running. The `starting`
  // phase also drains bootstrap steps (empty here, so the transition is
  // effectively instant). Assert terminal state == running.
  const started = await page.evaluate(async (id: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.rpc.call(['workenv', 'start'], { id })
    const row = (await w.wanda.rpc.call(['workenv', 'getById'], { id })) as WorkenvRow
    return row
  }, created.id)
  expect(started.state).toBe('running')

  // ---- Exec -------------------------------------------------------------
  // FakeAdapter's exec drains `execScript.data` (empty by default) and
  // resolves the `onExit` promise with `exitCode` (0 by default). The
  // `terminal:exit` broadcast can race the RPC response — depending on
  // Node event-loop scheduling, the exit may fire before the renderer
  // has called `onExit(streamId, ...)`. We rely instead on
  // `execGetScrollback` to return the cached exit code, which is immune
  // to the race. This exercises: workenv router → WorkenvExec →
  // FakeAdapter.exec → ExecSession → cached exit.
  const execResult = await page.evaluate(async (id: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    const { streamId } = (await w.wanda.rpc.call(['workenv', 'execStart'], {
      id,
      cmd: 'echo',
      args: ['hello'],
      pty: true,
    })) as { streamId: string }

    // Poll for cached exit code. Cheap; only called until resolved.
    let exitCode: number | null = null
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const snap = (await w.wanda.rpc.call(['workenv', 'execGetScrollback'], { streamId })) as {
        scrollback: string
        exitCode: number | null
      }
      if (snap.exitCode !== null) {
        exitCode = snap.exitCode
        break
      }
      await new Promise((r) => setTimeout(r, 20))
    }

    await w.wanda.rpc.call(['workenv', 'execDestroy'], { streamId })
    return { streamId, exitCode }
  }, created.id)
  expect(execResult.streamId.length).toBeGreaterThan(0)
  expect(execResult.exitCode).toBe(0)

  // ---- Stop -------------------------------------------------------------
  const stopped = await page.evaluate(async (id: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.rpc.call(['workenv', 'stop'], { id })
    return (await w.wanda.rpc.call(['workenv', 'getById'], { id })) as WorkenvRow
  }, created.id)
  expect(stopped.state).toBe('stopped')

  // ---- Destroy ----------------------------------------------------------
  // After destroy(), the row is either removed entirely or flipped to the
  // terminal `destroyed` state, depending on whether the adapter call
  // succeeded. FakeAdapter always succeeds, so the list.filter here
  // should find zero rows.
  const gone = await page.evaluate(async (id: string) => {
    const w = window as unknown as { wanda: WandaAPI }
    await w.wanda.rpc.call(['workenv', 'destroy'], { id })
    const list = (await w.wanda.rpc.call(['workenv', 'list'], {})) as WorkenvRow[]
    return list.some((row) => row.id === id)
  }, created.id)
  expect(gone).toBe(false)
})

test('workenv events accumulate across lifecycle transitions', async ({ wandaFake }) => {
  const page = wandaFake.mainWindow

  const { types, transitions } = await page.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const wrk = (await w.wanda.rpc.call(['workenv', 'create'], {
      name: 'e2e-events',
      slug: 'e2e-events',
      config: { runtime: 'orbstack', worktreePath: '/tmp/e2e-events' },
    })) as WorkenvRow
    await w.wanda.rpc.call(['workenv', 'start'], { id: wrk.id })
    await w.wanda.rpc.call(['workenv', 'stop'], { id: wrk.id })
    // NOTE: don't destroy here — the controller cascades-deletes events
    // when the workenv row is removed, so we'd read back an empty list.
    const rows = (await w.wanda.rpc.call(['workenv', 'listEvents'], { id: wrk.id, limit: 50 })) as Array<{
      type: string
      payload: { from?: string; to?: string } | null
    }>
    return {
      types: rows.map((r) => r.type),
      transitions: rows.filter((r) => r.type === 'state.changed' && r.payload?.to).map((r) => r.payload!.to!),
    }
  })

  // The event controller emits `created` once and `state.changed` for
  // every transition. We drove creating→stopped→starting→running→
  // stopping→stopped, so `to` values should include at least
  // stopped + running.
  expect(types).toContain('created')
  expect(types).toContain('state.changed')
  expect(transitions).toEqual(expect.arrayContaining(['stopped', 'running']))
})

test('workenv state transitions fire onStateChanged broadcasts', async ({ wandaFake }) => {
  const page = wandaFake.mainWindow

  const { transitions, createdEvents } = await page.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }

    // Subscribe BEFORE any RPC so we don't miss the first transition.
    const transitions: { from: string; to: string }[] = []
    const createdEvents: string[] = []
    const offS = w.wanda.workenv.onStateChanged((_id, from, to) => {
      transitions.push({ from, to })
    })
    const offC = w.wanda.workenv.onCreated((id) => {
      createdEvents.push(id)
    })

    const wrk = (await w.wanda.rpc.call(['workenv', 'create'], {
      name: 'e2e-transitions',
      slug: 'e2e-transitions',
      config: { runtime: 'orbstack', worktreePath: '/tmp/e2e-transitions' },
    })) as WorkenvRow
    await w.wanda.rpc.call(['workenv', 'start'], { id: wrk.id })
    await w.wanda.rpc.call(['workenv', 'stop'], { id: wrk.id })

    // Wait for any in-flight WS broadcasts to land. Tight bound so the
    // test fails quickly if broadcasts genuinely aren't arriving.
    const deadline = Date.now() + 1000
    while (
      Date.now() < deadline &&
      !(transitions.some((t) => t.to === 'running') && transitions.some((t) => t.to === 'stopped'))
    ) {
      await new Promise((r) => setTimeout(r, 20))
    }
    offS()
    offC()
    return { transitions, createdEvents }
  })

  expect(createdEvents.length).toBeGreaterThan(0)
  expect(transitions.some((t) => t.to === 'running')).toBe(true)
  expect(transitions.some((t) => t.to === 'stopped')).toBe(true)
})
