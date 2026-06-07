// -----------------------------------------------------------------------------
// OrbstackAdapter integration tests.
//
// These exercise the real `orbctl` CLI against a real OrbStack install. They
// are skipped unless:
//   - WANDA_INTEGRATION=1
//   - `orbctl` is present on PATH
//
// They're slow (~12s for create, ~15s for destroy), so the vitest integration
// project uses a 60s per-test + 90s hook timeout (see vitest.config.ts).
//
// Each test uses a unique `wanda-it-<millis>` VM name so parallel runs don't
// collide, and a beforeAll/afterAll cleans up anything left behind from
// earlier failures.
// -----------------------------------------------------------------------------

import { homedir } from 'node:os'
import { Effect } from 'effect'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { OrbstackAdapter } from '../orbstack'
import { describeIntegration } from './skip-integration'

const describe = describeIntegration('orbctl')

describe('OrbstackAdapter (integration)', () => {
  const adapter = new OrbstackAdapter()
  const runId = `it-${Date.now()}`
  const leftovers: string[] = []

  beforeAll(async () => {
    const probe = await Effect.runPromise(adapter.probe())
    if (!probe.available) throw new Error(`orbstack not available: ${probe.error}`)
  })

  afterAll(async () => {
    // Best-effort cleanup of any VMs created during this run.
    for (const name of leftovers) {
      await Effect.runPromise(
        Effect.either(
          adapter.destroy({
            runtime: 'orbstack',
            adapterHandle: name,
            state: { runtime: 'orbstack', vmName: name, arch: 'arm64' },
          }),
        ),
      )
    }
  }, 120_000)

  it('probe returns available with a non-empty version', async () => {
    const result = await Effect.runPromise(adapter.probe())
    expect(result.available).toBe(true)
    expect(result.version).toMatch(/\d+\.\d+/)
  })

  it('full lifecycle: create → list → status → start → exec → stop → destroy', async () => {
    const slug = `${runId}-lifecycle`
    const vmName = `wanda-${slug}`
    leftovers.push(vmName)

    // --- create
    const handle = await Effect.runPromise(
      adapter.create({
        slug,
        config: { runtime: 'orbstack', worktreePath: homedir() },
      }),
    )
    expect(handle.adapterHandle).toBe(vmName)
    expect(handle.state.runtime).toBe('orbstack')

    // --- list (handle should appear)
    const listed = await Effect.runPromise(adapter.list())
    expect(listed.map((h) => h.adapterHandle)).toContain(vmName)

    // --- status: orbctl create leaves the VM running by default
    const postCreate = await Effect.runPromise(adapter.status(handle))
    expect(postCreate.running).toBe(true)

    // --- stop
    await Effect.runPromise(adapter.stop(handle))
    const stopped = await Effect.runPromise(adapter.status(handle))
    expect(stopped.running).toBe(false)

    // --- start
    await Effect.runPromise(adapter.start(handle))
    const started = await Effect.runPromise(adapter.status(handle))
    expect(started.running).toBe(true)

    // --- destroy
    await Effect.runPromise(adapter.destroy(handle))
    const after = await Effect.runPromise(adapter.list())
    expect(after.map((h) => h.adapterHandle)).not.toContain(vmName)
  }, 90_000)

  it('create rejects worktreePath outside $HOME without spawning orbctl', async () => {
    const result = await Effect.runPromise(
      Effect.either(
        adapter.create({
          slug: `${runId}-bad`,
          config: { runtime: 'orbstack', worktreePath: '/private/tmp/outside-home' },
        }),
      ),
    )
    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left.message).toMatch(/\$?HOME|outside|worktree/i)
    }
  })

  it('destroy on an unknown VM is idempotent', async () => {
    const handle = {
      runtime: 'orbstack' as const,
      adapterHandle: `wanda-${runId}-ghost`,
      state: { runtime: 'orbstack' as const, vmName: `wanda-${runId}-ghost`, arch: 'arm64' as const },
    }
    await expect(Effect.runPromise(adapter.destroy(handle))).resolves.toBeUndefined()
  })
})
