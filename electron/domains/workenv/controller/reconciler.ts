// -----------------------------------------------------------------------------
// WorkenvReconciler — boot-time + on-demand stranded detection.
//
// Source of truth is SQLite. The adapter is consulted only to decide
// whether a persisted `adapterHandle` still exists in the real world.
// Anything else (events, lastError) is UI context.
//
// The reconciler runs once at server startup (see runtime.ts) and again
// whenever a user clicks "Check runtime availability" in the UI. Between
// those, reconcile is a no-op.
//
// Rules (keep simple):
//   - Skip rows in terminal (`destroyed`) or user-ack (`error`) state.
//   - Skip rows with no `adapterHandle` yet (create failed before handle
//     was persisted).
//   - If the runtime has no registered adapter → `stranded`.
//   - Else ask the adapter for its `list()`; if our handle isn't there → `stranded`.
//   - Do NOT re-strand an already-stranded row (stays in state; no event).
// -----------------------------------------------------------------------------

import { Context, Effect, Layer } from 'effect'
import type { WorkenvState } from '../../../../shared/contracts/workenv'
import { Broadcaster } from '../../../infra/broadcaster'
import { DatabaseService } from '../../../infra/database'
import { log } from '../../../packages/logger'
import { RuntimeRegistryService } from '../../../services/runtime-registry.service'
import { listWorkenvs, updateWorkenv } from '../repository'
import type { RuntimeAdapter } from '../types/adapter'
import { WorkenvEvents } from './events'
import { canTransition } from './lifecycle'

/** States that the reconciler considers for strand-checking. */
const CANDIDATE_STATES: ReadonlySet<WorkenvState> = new Set(['stopped', 'starting', 'running', 'stopping'])

export interface WorkenvReconcilerShape {
  readonly reconcile: () => Effect.Effect<{ stranded: number; checked: number }>
}

export class WorkenvReconciler extends Context.Tag('WorkenvReconciler')<WorkenvReconciler, WorkenvReconcilerShape>() {}

export const WorkenvReconcilerLive = Layer.effect(
  WorkenvReconciler,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const registry = yield* RuntimeRegistryService
    const events = yield* WorkenvEvents
    const broadcaster = yield* Broadcaster

    return {
      reconcile: () =>
        Effect.gen(function* () {
          const rows = listWorkenvs(db)
          let stranded = 0
          let checked = 0

          // Cache adapter.list() results per runtime so we don't re-list
          // for every workenv with the same runtime.
          const listCache = new Map<string, ReadonlySet<string> | 'missing' | 'error'>()

          for (const row of rows) {
            if (!CANDIDATE_STATES.has(row.state)) continue
            if (!row.adapterHandle) continue
            checked += 1

            const adapter = registry.get(row.runtime) as RuntimeAdapter | undefined
            if (!adapter) {
              yield* strand(row.id, row.state, 'no adapter registered')
              stranded += 1
              continue
            }

            let known = listCache.get(row.runtime)
            if (!known) {
              const listResult = yield* Effect.either(adapter.list())
              if (listResult._tag === 'Left') {
                // If we can't even ask the adapter, log + skip rather than
                // stranding every workenv. The probe banner will surface
                // the real problem.
                log.pod.warn(`reconciler: adapter.list() failed for runtime ${row.runtime}`, listResult.left)
                listCache.set(row.runtime, 'error')
                continue
              }
              known = new Set(listResult.right.map((h) => h.adapterHandle))
              listCache.set(row.runtime, known)
            }
            if (known === 'error' || known === 'missing') continue

            if (!known.has(row.adapterHandle)) {
              yield* strand(row.id, row.state, 'handle not present in adapter.list()')
              stranded += 1
            }
          }

          return { stranded, checked }
        }),
    }

    function strand(id: string, from: WorkenvState, reason: string) {
      return Effect.gen(function* () {
        if (!canTransition(from, 'stranded')) return
        updateWorkenv(db, id, { state: 'stranded', lastError: reason })
        yield* events.append({
          workenvId: id,
          type: 'state.changed',
          payload: { from, to: 'stranded', reason },
        })
        broadcaster.send('workenv.state.changed', id, from, 'stranded')
      })
    }
  }),
)
