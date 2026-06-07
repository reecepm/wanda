// -----------------------------------------------------------------------------
// Start/stop/restart runner for the workenv controller.
//
// Owns the runtime side of the lifecycle: driving the adapter through
// starting → running / stopping → stopped, compiling the per-start
// bootstrap pipeline (layer steps + runtime checks + capability-gated fs
// mounts + user/post-start steps), and recording every transition as a
// persisted event plus a `workenv.state.changed` broadcast.
//
// State-machine guards stay in `./lifecycle`; this only sequences the
// side effects around them. Extracted as a factory so the controller can
// share its resolved service handles and keep restart's forward
// reference to start/stop without re-entering the layer.
// -----------------------------------------------------------------------------

import { Effect } from 'effect'
import type { WorkenvState } from '../../../../shared/contracts/workenv'
import type { AppDatabase } from '../../../db/connection'
import type { BroadcasterShape } from '../../../infra/broadcaster'
import type { RuntimeRegistry } from '../../../services/runtime-registry.service'
import { getWorkenvById, updateWorkenv, type WorkenvRow } from '../repository'
import type { RuntimeAdapter } from '../types/adapter'
import type { BootstrapRunnerShape } from './bootstrap-runner'
import { compileLayerRuntimeChecks, compileLayers } from './compile-layers'
import {
  dedupeMounts,
  handleForRow,
  isCurrentPrebuildClone,
  postStartSteps,
  runtimeLayersAfterPrebuild,
  sleep,
  stepsForPrebuildState,
  unsupportedConfigFeature,
  userBootstrapSteps,
} from './config-utils'
import type { WorkenvEventsShape } from './events'
import type { WorkenvHealthShape } from './health'
import { assertTransition } from './lifecycle'
import { compileRuntimeMountSteps } from './runtime-mounts'

const START_WAIT_TIMEOUT_MS = 30 * 60 * 1000
const START_WAIT_POLL_MS = 1_000

export interface LifecycleDeps {
  readonly db: AppDatabase
  readonly events: WorkenvEventsShape
  readonly registry: RuntimeRegistry
  readonly broadcaster: BroadcasterShape
  readonly health: WorkenvHealthShape
  readonly bootstrap: BootstrapRunnerShape
}

export interface LifecycleRunner {
  readonly broadcastStateChange: (id: string, from: WorkenvState, to: WorkenvState) => void
  readonly transitionState: (id: string, from: WorkenvState, to: WorkenvState) => WorkenvRow
  readonly start: (id: string) => Effect.Effect<WorkenvRow, Error>
  readonly stop: (id: string) => Effect.Effect<WorkenvRow, Error>
  readonly restart: (id: string) => Effect.Effect<WorkenvRow, Error>
}

export function makeLifecycleRunner(deps: LifecycleDeps): LifecycleRunner {
  const { db, events, registry, broadcaster, health, bootstrap } = deps

  function broadcastStateChange(id: string, from: WorkenvState, to: WorkenvState): void {
    broadcaster.send('workenv.state.changed', id, from, to)
  }

  function transitionState(id: string, from: WorkenvState, to: WorkenvState): WorkenvRow {
    assertTransition(from, to)
    const row = updateWorkenv(db, id, { state: to })
    broadcastStateChange(id, from, to)
    return row
  }

  function waitForStartCompletion(id: string): Effect.Effect<WorkenvRow, Error> {
    return Effect.gen(function* () {
      const startedAt = Date.now()
      while (Date.now() - startedAt < START_WAIT_TIMEOUT_MS) {
        const latest = getWorkenvById(db, id)
        if (!latest) return yield* Effect.fail(new Error(`workenv ${id} not found`))
        if (latest.state === 'running') return latest
        if (latest.state === 'error') {
          return yield* Effect.fail(new Error(latest.lastError ?? `workenv ${id} failed to start`))
        }
        if (latest.state !== 'starting' && latest.state !== 'creating') {
          return yield* Effect.fail(new Error(`workenv ${id} left start flow in state '${latest.state}'`))
        }
        yield* sleep(START_WAIT_POLL_MS)
      }
      return yield* Effect.fail(new Error(`Timed out waiting for workenv ${id} to start`))
    })
  }

  function restart(id: string): Effect.Effect<WorkenvRow, Error> {
    return Effect.gen(function* () {
      const row = getWorkenvById(db, id)
      if (!row) return yield* Effect.fail(new Error(`workenv ${id} not found`))
      if (row.state === 'running') {
        yield* stop(id)
      }
      return yield* start(id)
    })
  }

  function start(id: string): Effect.Effect<WorkenvRow, Error> {
    return Effect.gen(function* () {
      const row = getWorkenvById(db, id)
      if (!row) return yield* Effect.fail(new Error(`workenv ${id} not found`))
      if (row.state === 'running') return row
      if (row.state === 'starting') return yield* waitForStartCompletion(id)

      const adapter = registry.get(row.runtime) as RuntimeAdapter | undefined
      if (!adapter) {
        return yield* Effect.fail(new Error(`No adapter registered for runtime '${row.runtime}'`))
      }
      const unsupported = unsupportedConfigFeature(row.config)
      if (unsupported) return yield* Effect.fail(new Error(`Unsupported workenv config: ${unsupported}`))
      const transitionResult = yield* Effect.either(Effect.sync(() => transitionState(id, row.state, 'starting')))
      if (transitionResult._tag === 'Left') {
        return yield* Effect.fail(new Error(`Cannot start workenv in state '${row.state}': ${transitionResult.left}`))
      }

      const handle = handleForRow(row)
      if (handle instanceof Error) return yield* Effect.fail(handle)
      const startResult = yield* Effect.either(adapter.start(handle))
      if (startResult._tag === 'Left') {
        const errMsg = startResult.left instanceof Error ? startResult.left.message : String(startResult.left)
        const errored = updateWorkenv(db, id, { state: 'error', lastError: errMsg })
        yield* events.append({
          workenvId: id,
          type: 'error',
          payload: { error: errMsg, phase: 'start' },
        })
        broadcastStateChange(id, 'starting', 'error')
        return errored
      }

      // Compile layer-derived bootstrap fresh at start time from the
      // persisted layer definitions. Do not re-resolve matching catalog
      // ids here: user templates often customize a built-in id's params
      // or install commands (for example a project-specific Go/pnpm
      // version), and replacing it at start would silently boot a
      // different environment than the stored config describes.
      const persistedLayers = row.config.layers ?? []
      const clonedFromPrebuild = isCurrentPrebuildClone(row.config, row.runtimeState)
      const layersToRun = clonedFromPrebuild ? runtimeLayersAfterPrebuild(persistedLayers) : persistedLayers
      const compiledLayers = layersToRun.length > 0 ? compileLayers(layersToRun) : undefined
      const layerSteps = compiledLayers?.bootstrap ?? []
      const verifySteps = compileLayerRuntimeChecks(persistedLayers)
      const allCompiledLayers = persistedLayers.length > 0 ? compileLayers(persistedLayers) : undefined
      const mountSteps = compileRuntimeMountSteps(
        {
          ...row.config,
          mounts: dedupeMounts([...(allCompiledLayers?.mounts ?? []), ...(row.config.mounts ?? [])]),
        },
        adapter.capabilities().fsSharingModel,
      )
      const steps = [
        ...layerSteps,
        ...verifySteps,
        ...mountSteps,
        ...stepsForPrebuildState(userBootstrapSteps(row.config), clonedFromPrebuild),
        ...stepsForPrebuildState(postStartSteps(row.config), clonedFromPrebuild),
      ]
      if (steps.length > 0) {
        const bootResult = yield* bootstrap.run(id, steps, handle, adapter)
        if (bootResult.failed > 0) {
          const errMsg = bootResult.failedStep
            ? `bootstrap step ${bootResult.failedStep.index} failed: ${bootResult.failedStep.error}`
            : 'bootstrap failed'
          updateWorkenv(db, id, { state: 'error', lastError: errMsg })
          yield* events.append({
            workenvId: id,
            type: 'error',
            payload: { error: errMsg, phase: 'bootstrap' },
          })
          broadcastStateChange(id, 'starting', 'error')
          // Fail the Effect so callers (e.g. pod auto-start) see the
          // failure, not a successful-looking row stuck in 'error'.
          return yield* Effect.fail(new Error(errMsg))
        }
      }

      updateWorkenv(db, id, { lastStartedAt: new Date(), lastError: null })
      const final = transitionState(id, 'starting', 'running')
      yield* events.append({
        workenvId: id,
        type: 'state.changed',
        payload: { from: 'starting', to: 'running' },
      })
      // Now that the workenv is up, kick off health polling so status
      // reflects reality.
      health.startPolling(id)
      return final
    })
  }

  function stop(id: string): Effect.Effect<WorkenvRow, Error> {
    return Effect.gen(function* () {
      const row = getWorkenvById(db, id)
      if (!row) return yield* Effect.fail(new Error(`workenv ${id} not found`))

      const adapter = registry.get(row.runtime) as RuntimeAdapter | undefined
      if (!adapter) {
        return yield* Effect.fail(new Error(`No adapter registered for runtime '${row.runtime}'`))
      }
      const transitionResult = yield* Effect.either(Effect.sync(() => transitionState(id, row.state, 'stopping')))
      if (transitionResult._tag === 'Left') {
        return yield* Effect.fail(new Error(`Cannot stop workenv in state '${row.state}': ${transitionResult.left}`))
      }

      const handle = handleForRow(row)
      if (handle instanceof Error) return yield* Effect.fail(handle)
      const stopResult = yield* Effect.either(adapter.stop(handle))
      if (stopResult._tag === 'Left') {
        const errMsg = stopResult.left instanceof Error ? stopResult.left.message : String(stopResult.left)
        const errored = updateWorkenv(db, id, { state: 'error', lastError: errMsg })
        yield* events.append({
          workenvId: id,
          type: 'error',
          payload: { error: errMsg, phase: 'stop' },
        })
        broadcastStateChange(id, 'stopping', 'error')
        return errored
      }

      health.stopPolling(id)
      updateWorkenv(db, id, { lastStoppedAt: new Date(), lastError: null })
      const final = transitionState(id, 'stopping', 'stopped')
      yield* events.append({
        workenvId: id,
        type: 'state.changed',
        payload: { from: 'stopping', to: 'stopped' },
      })
      return final
    })
  }

  return { broadcastStateChange, transitionState, start, stop, restart }
}
