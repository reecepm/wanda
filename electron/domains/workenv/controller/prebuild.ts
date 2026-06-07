// -----------------------------------------------------------------------------
// Prebuild orchestration for the workenv controller.
//
// When an adapter supports cheap clones, image-time layers (base/pkg/tool)
// are baked once into a central "template" machine keyed by a content
// hash, then cloned per workenv. This module owns building/reusing that
// template: cache lookup + adoption, stale-machine cleanup, running the
// prebuild steps, and waiting for an in-flight build to finish.
//
// Extracted as a factory (not an Effect service) so the controller can
// share its already-resolved db/broadcaster/templates handles without a
// second layer of context wiring. The adapter is passed per call.
// -----------------------------------------------------------------------------

import { homedir } from 'node:os'
import { Effect } from 'effect'
import type { WorkenvBootstrapStep, WorkenvConfig } from '../../../../shared/contracts/workenv'
import { workenvRuntimeStateSchema } from '../../../../shared/contracts/workenv-runtime-state'
import type { AppDatabase } from '../../../db/connection'
import type { BroadcasterShape } from '../../../infra/broadcaster'
import { log } from '../../../packages/logger'
import {
  adoptPrebuildCacheKey,
  createPrebuild,
  getPrebuildById,
  listPrebuilds,
  markPrebuildError,
  markPrebuildMissingRuntime,
  markPrebuildReady,
  resetPrebuildBuild,
  updatePrebuildHandle,
} from '../repository'
import type { RuntimeAdapter, WorkenvHandle } from '../types/adapter'
import { bootstrapStepName, execRequestForBootstrapStep, plainEnv } from './bootstrap-steps'
import { applyCompiledLayers, compileLayers } from './compile-layers'
import {
  prebuildCacheKeyForConfig,
  prebuildConfigFor,
  prebuildSteps,
  sleep,
  stripStaleCompiledBootstrap,
  tailOutput,
} from './config-utils'
import type { WorkenvTemplatesShape } from './templates'

const PREBUILD_WAIT_TIMEOUT_MS = 30 * 60 * 1000
const PREBUILD_WAIT_POLL_MS = 1_000

export type PrebuildSource = { readonly workenvId: string } | { readonly templateId: string }

export interface TemplatePrebuildStatus {
  readonly templateId: string
  readonly hash: string | null
  readonly state: 'not_built' | 'creating' | 'ready' | 'error'
  readonly adapterHandle: string | null
  readonly lastError: string | null
  readonly updatedAt: Date | null
}

export interface PrebuildDeps {
  readonly db: AppDatabase
  readonly broadcaster: BroadcasterShape
  readonly templates: WorkenvTemplatesShape
}

export interface Prebuild {
  readonly ensurePrebuild: (
    source: PrebuildSource,
    config: WorkenvConfig,
    adapter: RuntimeAdapter,
  ) => Effect.Effect<{ hash: string; handle: WorkenvHandle } | undefined, Error>
  readonly compiledTemplateConfig: (templateId: string) => Effect.Effect<WorkenvConfig, Error>
  readonly templatePrebuildStatus: (templateId: string) => Effect.Effect<TemplatePrebuildStatus, Error>
}

export function makePrebuild(deps: PrebuildDeps): Prebuild {
  const { db, broadcaster, templates } = deps

  function waitForPrebuildReady(hash: string): Effect.Effect<WorkenvHandle, Error> {
    return Effect.gen(function* () {
      const startedAt = Date.now()
      while (Date.now() - startedAt < PREBUILD_WAIT_TIMEOUT_MS) {
        const row = getPrebuildById(db, hash)
        if (!row) return yield* Effect.fail(new Error(`workenv prebuild ${hash} disappeared`))
        if (row.state === 'ready' && row.adapterHandle && row.runtimeState) {
          const parsedState = workenvRuntimeStateSchema.safeParse(row.runtimeState)
          if (!parsedState.success) {
            return yield* Effect.fail(new Error(`workenv prebuild ${hash} has invalid runtime state`))
          }
          return { runtime: row.runtime, adapterHandle: row.adapterHandle, state: parsedState.data }
        }
        if (row.state === 'error') {
          return yield* Effect.fail(new Error(row.lastError ?? `workenv prebuild ${hash} failed`))
        }
        yield* sleep(PREBUILD_WAIT_POLL_MS)
      }
      return yield* Effect.fail(new Error(`Timed out waiting for workenv prebuild ${hash}`))
    })
  }

  function runPrebuildSteps(
    templateId: string,
    hash: string,
    config: WorkenvConfig,
    steps: readonly WorkenvBootstrapStep[],
    handle: WorkenvHandle,
    adapter: RuntimeAdapter,
  ): Effect.Effect<void, Error> {
    return Effect.gen(function* () {
      const env = {
        ...plainEnv(config.env),
        WANDA_PREBUILD: '1',
        WANDA_WORKTREE_PATH: config.worktreePath,
        ...(config.workdir ? { WANDA_WORKDIR: config.workdir } : {}),
      }
      for (const [i, step] of steps.entries()) {
        const name = bootstrapStepName(step)
        broadcaster.send('workenv.prebuild.progress', templateId, hash, i, name, 'started')

        const result = yield* Effect.either(
          Effect.tryPromise({
            try: async () => {
              const session = adapter.exec(handle, execRequestForBootstrapStep(step, env))
              let output = ''
              session.onData((chunk) => {
                output += chunk
                broadcaster.send('workenv.prebuild.log', templateId, hash, chunk)
              })
              const exitCode = await session.exit
              return { exitCode, output }
            },
            catch: (err) => (err instanceof Error ? err : new Error(String(err))),
          }),
        )

        if (result._tag === 'Left') {
          broadcaster.send('workenv.prebuild.progress', templateId, hash, i, name, 'failed')
          return yield* Effect.fail(result.left)
        }
        if (result.right.exitCode !== 0) {
          broadcaster.send('workenv.prebuild.progress', templateId, hash, i, name, 'failed')
          return yield* Effect.fail(
            new Error(`prebuild step ${i} failed: exit ${result.right.exitCode}: ${tailOutput(result.right.output)}`),
          )
        }

        broadcaster.send('workenv.prebuild.progress', templateId, hash, i, name, 'succeeded')
      }
    })
  }

  function adoptCompatiblePrebuild(hash: string, prebuildConfig: WorkenvConfig) {
    const compatible = listPrebuilds(db)
      .filter((row) => row.runtime === prebuildConfig.runtime)
      .filter((row) => prebuildCacheKeyForConfig(row.config) === hash)
      .sort((a, b) => {
        const rank = (state: string) => (state === 'ready' ? 0 : state === 'creating' ? 1 : 2)
        return rank(a.state) - rank(b.state)
      })[0]
    if (!compatible) return undefined
    if (compatible.id === hash) return compatible

    return adoptPrebuildCacheKey(db, compatible.id, hash)
  }

  function ensurePrebuild(
    source: PrebuildSource,
    config: WorkenvConfig,
    adapter: RuntimeAdapter,
  ): Effect.Effect<{ hash: string; handle: WorkenvHandle } | undefined, Error> {
    return Effect.gen(function* () {
      if (!adapter.clone) return undefined
      const prebuildConfig = prebuildConfigFor(config)
      if (!prebuildConfig) return undefined

      const hash = prebuildCacheKeyForConfig(prebuildConfig)
      const existing = getPrebuildById(db, hash) ?? adoptCompatiblePrebuild(hash, prebuildConfig)

      if (existing?.state === 'ready' && existing.adapterHandle && existing.runtimeState) {
        const handle: WorkenvHandle = {
          runtime: existing.runtime,
          adapterHandle: existing.adapterHandle,
          state: existing.runtimeState,
        }
        const status = yield* Effect.either(adapter.status(handle))
        if (status._tag === 'Right') return { hash, handle }
        markPrebuildMissingRuntime(db, hash, `cached template missing from runtime: ${status.left.message}`)
      } else if (existing?.state === 'creating') {
        const handle = yield* waitForPrebuildReady(hash)
        return { hash, handle }
      }

      if (existing?.adapterHandle && existing.runtimeState) {
        const staleHandle: WorkenvHandle = {
          runtime: existing.runtime,
          adapterHandle: existing.adapterHandle,
          state: existing.runtimeState,
        }
        const cleanup = yield* Effect.either(adapter.destroy(staleHandle))
        if (cleanup._tag === 'Left') {
          log.pod.warn(`prebuild ${hash}: failed to clean stale template machine`, cleanup.left)
        }
      }

      if (!existing) {
        createPrebuild(db, { hash, runtime: prebuildConfig.runtime, config: prebuildConfig })
      } else {
        resetPrebuildBuild(db, hash, prebuildConfig)
      }

      const templateSlug = `template-${hash.slice(0, 12)}`
      const createResult = yield* Effect.either(adapter.create({ slug: templateSlug, config: prebuildConfig }))
      if (createResult._tag === 'Left') {
        const errMsg = createResult.left.message
        markPrebuildError(db, hash, errMsg)
        return yield* Effect.fail(new Error(errMsg))
      }

      const handle = createResult.right
      updatePrebuildHandle(db, hash, { adapterHandle: handle.adapterHandle, runtimeState: handle.state })

      const startResult = yield* Effect.either(adapter.start(handle))
      if (startResult._tag === 'Left') {
        const errMsg = startResult.left.message
        markPrebuildError(db, hash, errMsg)
        return yield* Effect.fail(new Error(errMsg))
      }

      const steps = [...compileLayers(prebuildConfig.layers ?? []).bootstrap, ...prebuildSteps(prebuildConfig)]
      if (steps.length > 0) {
        const ownerId = 'templateId' in source ? source.templateId : source.workenvId
        const buildResult = yield* Effect.either(
          runPrebuildSteps(ownerId, hash, prebuildConfig, steps, handle, adapter),
        )
        if (buildResult._tag === 'Left') {
          const errMsg = buildResult.left.message
          markPrebuildError(db, hash, errMsg)
          return yield* Effect.fail(new Error(errMsg))
        }
      }

      const stopResult = yield* Effect.either(adapter.stop(handle))
      if (stopResult._tag === 'Left') {
        log.pod.warn(`prebuild ${hash}: failed to stop template machine after build`, stopResult.left)
      }

      markPrebuildReady(db, hash)

      return { hash, handle }
    })
  }

  function compiledTemplateConfig(templateId: string): Effect.Effect<WorkenvConfig, Error> {
    return Effect.gen(function* () {
      const tpl = yield* templates.getById(templateId)
      if (!tpl) return yield* Effect.fail(new Error(`workenv template ${templateId} not found`))
      const compiled = yield* templates.compile({
        runtime: tpl.runtime,
        worktreePath: `${homedir()}/.wanda/prebuilds/${templateId}`,
        extends: [templateId],
      })
      return stripStaleCompiledBootstrap(applyCompiledLayers(compiled))
    })
  }

  function templatePrebuildStatus(templateId: string): Effect.Effect<TemplatePrebuildStatus, Error> {
    return Effect.gen(function* () {
      const config = yield* compiledTemplateConfig(templateId)
      const prebuildConfig = prebuildConfigFor(config)
      if (!prebuildConfig) {
        return {
          templateId,
          hash: null,
          state: 'not_built' as const,
          adapterHandle: null,
          lastError: null,
          updatedAt: null,
        }
      }
      const hash = prebuildCacheKeyForConfig(prebuildConfig)
      const row = getPrebuildById(db, hash) ?? adoptCompatiblePrebuild(hash, prebuildConfig)
      return {
        templateId,
        hash,
        state: row?.state ?? 'not_built',
        adapterHandle: row?.adapterHandle ?? null,
        lastError: row?.lastError ?? null,
        updatedAt: row?.updatedAt ?? null,
      }
    })
  }

  return { ensurePrebuild, compiledTemplateConfig, templatePrebuildStatus }
}
