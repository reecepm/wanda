// -----------------------------------------------------------------------------
// WorkenvController — main orchestrator.
//
// Owns create + update + destroy and the read paths, and wires together
// the cohesive sub-modules:
//
//   ./config-utils      — pure config hashing / step filtering / handle parse
//   ./prebuild          — template prebuild build + cache (clone-capable runtimes)
//   ./lifecycle-runner  — start / stop / restart side-effect sequencing
//   ./lifecycle         — state-machine guards (assertTransition)
//
// Anything that mutates `workenvs.state` goes through the lifecycle
// runner's `transitionState`, which calls `assertTransition()` first so
// we never backslide.
// -----------------------------------------------------------------------------

import { Context, Effect, Layer } from 'effect'
import type { WorkenvConfig } from '../../../../shared/contracts/workenv'
import { workenvConfigSchema } from '../../../../shared/contracts/workenv'
import { Broadcaster } from '../../../infra/broadcaster'
import { DatabaseService } from '../../../infra/database'
import { log } from '../../../packages/logger'
import { RuntimeRegistryService } from '../../../services/runtime-registry.service'
import {
  createWorkenv,
  deletePodsAttachedToWorkenv,
  deleteWorkenv,
  getWorkenvById,
  getWorkenvBySlug,
  listWorkenvs,
  updateWorkenv,
  type WorkenvRow,
} from '../repository'
import type { RuntimeAdapter } from '../types/adapter'
import { BootstrapRunner } from './bootstrap-runner'
import { applyCompiledLayers } from './compile-layers'
import {
  handleForRow,
  hashConfig,
  prebuildCacheKeyForConfig,
  stripStaleCompiledBootstrap,
  unsupportedConfigFeature,
  userBootstrapSteps,
} from './config-utils'
import { type ConfigChangeReport, classifyConfigChange } from './edit-classifier'
import { WorkenvEvents } from './events'
import { WorkenvHealth } from './health'
import { makeLifecycleRunner } from './lifecycle-runner'
import { makePrebuild } from './prebuild'
import { WorkenvTemplates } from './templates'

// Re-exported for tests and call sites that depend on the controller's
// config helpers staying importable from this module.
export { prebuildCacheKeyForConfig, stripStaleCompiledBootstrap, userBootstrapSteps }

export interface CreateInput {
  readonly name: string
  readonly slug: string
  readonly config: WorkenvConfig
  readonly templateId?: string | null
}

interface UpdateInput {
  readonly name?: string
  readonly config?: WorkenvConfig
}

interface UpdateResult {
  readonly row: WorkenvRow
  readonly report: ConfigChangeReport
}

interface DestroyOptions {
  /**
   * When true, delete attached pods rather than detach them. Default is
   * detach (pods stay, their `workenvId` becomes null via FK `set null`).
   */
  readonly deletePods?: boolean
  /**
   * User intent to also destroy any adapter-managed named volumes. For
   * Current adapters destroy the VM disk with the VM. Reserved for future
   * adapters that manage volumes out-of-band.
   */
  readonly withVolumes?: boolean
}

export interface WorkenvControllerShape {
  readonly list: () => Effect.Effect<WorkenvRow[]>
  readonly getById: (id: string) => Effect.Effect<WorkenvRow | undefined>
  readonly create: (input: CreateInput) => Effect.Effect<WorkenvRow, Error>
  readonly update: (id: string, patch: UpdateInput) => Effect.Effect<UpdateResult, Error>
  readonly destroy: (id: string, opts?: DestroyOptions) => Effect.Effect<void>
  readonly prebuildTemplate: (
    templateId: string,
  ) => Effect.Effect<{ readonly templateId: string; readonly hash: string; readonly adapterHandle: string }, Error>
  readonly getTemplatePrebuildStatus: (templateId: string) => Effect.Effect<
    {
      readonly templateId: string
      readonly hash: string | null
      readonly state: 'not_built' | 'creating' | 'ready' | 'error'
      readonly adapterHandle: string | null
      readonly lastError: string | null
      readonly updatedAt: Date | null
    },
    Error
  >
  readonly start: (id: string) => Effect.Effect<WorkenvRow, Error>
  readonly stop: (id: string) => Effect.Effect<WorkenvRow, Error>
  readonly restart: (id: string) => Effect.Effect<WorkenvRow, Error>
}

export class WorkenvController extends Context.Tag('WorkenvController')<WorkenvController, WorkenvControllerShape>() {}

export const WorkenvControllerLive = Layer.effect(
  WorkenvController,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const events = yield* WorkenvEvents
    const registry = yield* RuntimeRegistryService
    const broadcaster = yield* Broadcaster
    const health = yield* WorkenvHealth
    const templates = yield* WorkenvTemplates
    const bootstrap = yield* BootstrapRunner

    const prebuilder = makePrebuild({ db, broadcaster, templates })
    const lifecycle = makeLifecycleRunner({ db, events, registry, broadcaster, health, bootstrap })
    const { broadcastStateChange, transitionState } = lifecycle

    return {
      list: () => Effect.sync(() => listWorkenvs(db)),
      getById: (id) => Effect.sync(() => getWorkenvById(db, id)),

      create: (input) =>
        Effect.gen(function* () {
          // 1. Validate config up-front so a bad payload doesn't even touch the adapter.
          const parsed = workenvConfigSchema.safeParse(input.config)
          if (!parsed.success) {
            return yield* Effect.fail(new Error(`Invalid workenv config: ${parsed.error.message}`))
          }
          // 1a. Resolve any `extends` template refs into the final config.
          //     Compile failure (unknown ref) propagates as a typed Effect error.
          const compiledResult = yield* Effect.either(templates.compile(parsed.data))
          if (compiledResult._tag === 'Left') {
            return yield* Effect.fail(compiledResult.left)
          }
          const unsupported = unsupportedConfigFeature(compiledResult.right)
          if (unsupported) return yield* Effect.fail(new Error(`Unsupported workenv config: ${unsupported}`))
          // 1b. Compile composable layers (base/tool/auth/…) into the flat
          //     (mounts, ports, env, bootstrap) shape adapters consume.
          const config = stripStaleCompiledBootstrap(applyCompiledLayers(compiledResult.right))

          // 2. Slug uniqueness — cheap pre-check; the unique index on
          //    workenvs.adapter_handle catches adapter-level races later.
          if (getWorkenvBySlug(db, input.slug)) {
            return yield* Effect.fail(new Error(`workenv slug '${input.slug}' is already taken`))
          }

          // 3. Adapter registered for this runtime?
          const adapter = registry.get(config.runtime) as RuntimeAdapter | undefined
          if (!adapter) {
            return yield* Effect.fail(new Error(`No adapter registered for runtime '${config.runtime}'`))
          }

          // 4. Insert row in 'creating' state. From here on, errors update
          //    the row to 'error' rather than discarding it, so the user
          //    can see why creation failed in the UI.
          const inserted = createWorkenv(db, {
            name: input.name,
            slug: input.slug,
            worktreePath: config.worktreePath,
            runtime: config.runtime,
            configHash: hashConfig(config),
            config,
            templateId: input.templateId ?? null,
            state: 'creating',
          })
          yield* events.append({ workenvId: inserted.id, type: 'created' })
          broadcaster.send('workenv.created', inserted.id)

          // 5. Spawn the underlying VM/container. If the adapter supports
          // cheap clones, first build/reuse a central template machine from
          // image-time layers (base/pkg/tool), then clone it per pod.
          const prebuildResult = yield* Effect.either(
            prebuilder.ensurePrebuild({ workenvId: inserted.id }, config, adapter),
          )
          if (prebuildResult._tag === 'Left') {
            const errMsg = prebuildResult.left.message
            const errored = updateWorkenv(db, inserted.id, { state: 'error', lastError: errMsg })
            yield* events.append({
              workenvId: inserted.id,
              type: 'error',
              payload: { error: errMsg, phase: 'prebuild' },
            })
            broadcastStateChange(inserted.id, 'creating', 'error')
            return errored
          }

          const prebuild = prebuildResult.right
          const adapterResult = yield* Effect.either(
            prebuild && adapter.clone
              ? adapter.clone(prebuild.handle, { slug: input.slug, config })
              : adapter.create({ slug: input.slug, config }),
          )
          if (adapterResult._tag === 'Left') {
            const errMsg = adapterResult.left instanceof Error ? adapterResult.left.message : String(adapterResult.left)
            const errored = updateWorkenv(db, inserted.id, { state: 'error', lastError: errMsg })
            yield* events.append({
              workenvId: inserted.id,
              type: 'error',
              payload: { error: errMsg, phase: 'create' },
            })
            broadcastStateChange(inserted.id, 'creating', 'error')
            return errored
          }

          const handle = adapterResult.right
          const runtimeState =
            prebuild && handle.state.runtime === 'orbstack'
              ? { ...handle.state, prebuildHash: prebuild.hash }
              : handle.state

          // 6. Persist handle + flip to 'stopped' (terminal of "create" path).
          updateWorkenv(db, inserted.id, {
            adapterHandle: handle.adapterHandle,
            runtimeState,
          })
          const final = transitionState(inserted.id, 'creating', 'stopped')
          yield* events.append({
            workenvId: inserted.id,
            type: 'state.changed',
            payload: { from: 'creating', to: 'stopped' },
          })
          return final
        }),

      destroy: (id, opts) =>
        Effect.gen(function* () {
          const row = getWorkenvById(db, id)
          if (!row) return

          health.stopPolling(id)

          // Pods attached to this workenv detach automatically via the FK
          // `onDelete: 'set null'`. If the caller asked to delete them
          // instead, do that up front before the row disappears.
          if (opts?.deletePods) {
            deletePodsAttachedToWorkenv(db, id)
          }

          // Best-effort adapter teardown — if this fails (vm already
          // gone, adapter uninstalled), still remove the row so the user
          // isn't stuck with a zombie entry.
          if (row.adapterHandle) {
            const adapter = registry.get(row.runtime) as RuntimeAdapter | undefined
            if (adapter) {
              const handle = handleForRow(row)
              if (handle instanceof Error) {
                log.pod.warn(`adapter.destroy skipped for workenv ${id}; force-deleting row`, handle)
              } else {
                const tearDown = yield* Effect.either(adapter.destroy(handle))
                if (tearDown._tag === 'Left') {
                  log.pod.warn(`adapter.destroy failed for workenv ${id}; force-deleting row`, tearDown.left)
                }
              }
            }
          }

          // withVolumes is captured as caller intent for the event log.
          // Current adapters destroy the VM disk with the VM, so there is
          // nothing extra to do here today.
          if (opts?.withVolumes) {
            log.pod.info(`destroy workenv ${id} with volumes intent (adapter handles via disk teardown)`)
          }

          deleteWorkenv(db, id)
          broadcaster.send('workenv.destroyed', id)
        }),

      prebuildTemplate: (templateId) =>
        Effect.gen(function* () {
          const config = yield* prebuilder.compiledTemplateConfig(templateId)
          const adapter = registry.get(config.runtime) as RuntimeAdapter | undefined
          if (!adapter) {
            return yield* Effect.fail(new Error(`No adapter registered for runtime '${config.runtime}'`))
          }
          if (!adapter.clone) {
            return yield* Effect.fail(
              new Error(`Runtime '${config.runtime}' does not support prebuilt template clones`),
            )
          }

          const prebuild = yield* prebuilder.ensurePrebuild({ templateId }, config, adapter)
          if (!prebuild) {
            return yield* Effect.fail(new Error(`template ${templateId} has no prebuildable layers`))
          }
          return {
            templateId,
            hash: prebuild.hash,
            adapterHandle: prebuild.handle.adapterHandle,
          }
        }),

      getTemplatePrebuildStatus: (templateId) => prebuilder.templatePrebuildStatus(templateId),

      update: (id, patch) =>
        Effect.gen(function* () {
          const row = getWorkenvById(db, id)
          if (!row) return yield* Effect.fail(new Error(`workenv ${id} not found`))

          let nextConfig = row.config
          let report: ConfigChangeReport = {
            impact: 'live',
            changedKeys: [],
            recreateKeys: [],
            restartKeys: [],
            liveKeys: [],
          }

          if (patch.config) {
            const parsed = workenvConfigSchema.safeParse(patch.config)
            if (!parsed.success) {
              return yield* Effect.fail(new Error(`Invalid workenv config: ${parsed.error.message}`))
            }
            const compiled = yield* templates.compile(parsed.data)
            const unsupported = unsupportedConfigFeature(compiled)
            if (unsupported) return yield* Effect.fail(new Error(`Unsupported workenv config: ${unsupported}`))
            nextConfig = stripStaleCompiledBootstrap(applyCompiledLayers(compiled))
            report = classifyConfigChange(row.config, nextConfig)
          }

          const patchToWrite: Parameters<typeof updateWorkenv>[2] = {}
          if (patch.name !== undefined) patchToWrite.name = patch.name
          if (patch.config) {
            patchToWrite.config = nextConfig
            patchToWrite.configHash = hashConfig(nextConfig)
            patchToWrite.worktreePath = nextConfig.worktreePath
          }
          const updated = updateWorkenv(db, id, patchToWrite)
          broadcaster.send('workenv.updated', id)
          return { row: updated, report }
        }),

      start: (id) => lifecycle.start(id),
      stop: (id) => lifecycle.stop(id),
      restart: (id) => lifecycle.restart(id),
    }
  }),
)
