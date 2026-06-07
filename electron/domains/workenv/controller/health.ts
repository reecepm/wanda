// -----------------------------------------------------------------------------
// WorkenvHealth — periodic healthcheck poller.
//
// For every running workenv with a `config.healthcheck`, run the
// configured `cmd` inside the VM on `intervalSec` cadence (after the
// initial `startPeriodSec` grace). Broadcast `workenv.health` on
// transitions ok↔failed, and persist `lastHealthyAt` on success.
//
// Checks run via `adapter.exec()` with `pty: false` — we only care about
// the exit code. Sessions are one-shot; we wait for `session.exit` and
// destroy the session immediately after.
//
// Noise reduction: we remember the last ok/failed status per workenv and
// skip re-broadcasting identical consecutive states. A "flap" (ok →
// failed → ok within `intervalSec`) still emits both edges.
// -----------------------------------------------------------------------------

import { Context, Effect, Layer } from 'effect'
import { Broadcaster } from '../../../infra/broadcaster'
import { DatabaseService } from '../../../infra/database'
import { log } from '../../../packages/logger'
import { RuntimeRegistryService } from '../../../services/runtime-registry.service'
import { getWorkenvById, updateWorkenv } from '../repository'
import type { RuntimeAdapter, WorkenvHandle } from '../types/adapter'
import { WorkenvEvents } from './events'

const DEFAULT_INTERVAL_MS = 30_000

export interface WorkenvHealthShape {
  /** One-shot poll. Returns `{ ok }` or `null` when the check was skipped. */
  readonly pollOnce: (workenvId: string) => Effect.Effect<{ ok: boolean } | null>
  /** Begin periodic polling for a workenv. Idempotent. */
  readonly startPolling: (workenvId: string) => void
  /** Stop polling for a workenv. Idempotent. */
  readonly stopPolling: (workenvId: string) => void
  /** Stop every active poll loop. */
  readonly stopAll: () => void
}

export class WorkenvHealth extends Context.Tag('WorkenvHealth')<WorkenvHealth, WorkenvHealthShape>() {}

export const WorkenvHealthLive = Layer.effect(
  WorkenvHealth,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const registry = yield* RuntimeRegistryService
    const events = yield* WorkenvEvents
    const broadcaster = yield* Broadcaster

    const timers = new Map<string, ReturnType<typeof setInterval>>()
    const lastStatus = new Map<string, boolean>()

    function pollOnce(workenvId: string): Effect.Effect<{ ok: boolean } | null> {
      return Effect.gen(function* () {
        const row = getWorkenvById(db, workenvId)
        if (!row) return null
        if (row.state !== 'running') return null
        const hc = row.config.healthcheck
        if (!hc) return null

        // Grace window: skip while inside startPeriodSec after lastStartedAt.
        const started = row.lastStartedAt ? row.lastStartedAt.getTime() : 0
        if (started && Date.now() - started < hc.startPeriodSec * 1000) {
          return null
        }

        const adapter = registry.get(row.runtime) as RuntimeAdapter | undefined
        if (!adapter || !row.adapterHandle || !row.runtimeState) return null
        const handle: WorkenvHandle = {
          runtime: row.runtime,
          adapterHandle: row.adapterHandle,
          state: row.runtimeState,
        }

        const session = adapter.exec(handle, { cmd: '/bin/sh', args: ['-c', hc.cmd], pty: false })
        const code = yield* Effect.tryPromise({
          try: () => session.exit,
          catch: (err) => (err instanceof Error ? err : new Error(String(err))),
        }).pipe(Effect.orElseSucceed(() => 1))
        // Destroy the one-shot session — some adapters keep the PTY handle
        // alive until an explicit destroy.
        try {
          session.destroy()
        } catch {
          // Ignore — destroy is best-effort.
        }

        const ok = code === 0
        const prev = lastStatus.get(workenvId)
        lastStatus.set(workenvId, ok)

        if (ok) {
          updateWorkenv(db, workenvId, { lastHealthyAt: new Date() })
        }

        // Only broadcast on edge transitions (first check or flip).
        if (prev === undefined || prev !== ok) {
          broadcaster.send('workenv.health', workenvId, ok)
          yield* events.append({
            workenvId,
            type: ok ? 'health.ok' : 'health.failed',
            payload: ok ? undefined : { exitCode: code },
          })
        }

        return { ok }
      })
    }

    function startPolling(workenvId: string): void {
      if (timers.has(workenvId)) return
      const row = getWorkenvById(db, workenvId)
      const intervalMs = row?.config.healthcheck?.intervalSec
        ? row.config.healthcheck.intervalSec * 1000
        : DEFAULT_INTERVAL_MS
      const tick = () => {
        Effect.runPromise(pollOnce(workenvId)).catch((err) => {
          log.pod.warn(`health pollOnce failed for workenv ${workenvId}`, err)
        })
      }
      const timer = setInterval(tick, intervalMs)
      timers.set(workenvId, timer)
    }

    function stopPolling(workenvId: string): void {
      const timer = timers.get(workenvId)
      if (!timer) return
      clearInterval(timer)
      timers.delete(workenvId)
      lastStatus.delete(workenvId)
    }

    function stopAll(): void {
      for (const timer of timers.values()) clearInterval(timer)
      timers.clear()
      lastStatus.clear()
    }

    return { pollOnce, startPolling, stopPolling, stopAll }
  }),
)
