// -----------------------------------------------------------------------------
// Pure config helpers for the workenv controller.
//
// Hashing, prebuild-config derivation, bootstrap-step filtering, and the
// handle/runtime-state validation shared by create/start/prebuild. No
// Effect, no I/O — same inputs always yield the same outputs.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import type { WorkenvConfig, WorkenvLayer, WorkenvMount } from '../../../../shared/contracts/workenv'
import { workenvRuntimeStateSchema } from '../../../../shared/contracts/workenv-runtime-state'
import type { WorkenvRow } from '../repository'
import type { WorkenvHandle } from '../types/adapter'
import { compileLayers } from './compile-layers'

export type BootstrapStep = NonNullable<WorkenvConfig['bootstrap']>[number]

// Lightweight (non-cryptographic) hash for workenvs.config_hash. Just
// a content fingerprint so the UI can show "config changed → restart
// required" without hashing the world.
export function hashConfig(config: WorkenvConfig): string {
  return createHash('sha256').update(stableStringify(config)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function prebuildableLayers(layers: readonly WorkenvLayer[] | undefined): WorkenvLayer[] {
  return (layers ?? []).filter((layer) => layer.kind === 'base' || layer.kind === 'pkg' || layer.kind === 'tool')
}

export function runtimeLayersAfterPrebuild(layers: readonly WorkenvLayer[] | undefined): WorkenvLayer[] {
  return (layers ?? []).filter((layer) => layer.kind !== 'base' && layer.kind !== 'pkg' && layer.kind !== 'tool')
}

export function prebuildConfigFor(config: WorkenvConfig): WorkenvConfig | undefined {
  const layers = prebuildableLayers(config.layers)
  const prebuild = config.prebuild ?? []
  if (layers.length === 0 && prebuild.length === 0) return undefined
  const compiled = compileLayers(layers)
  const prebuildConfig: WorkenvConfig = {
    runtime: config.runtime,
    worktreePath: config.worktreePath,
    layers,
    base: config.base ?? compiled.base,
    ...(prebuild.length > 0 ? { prebuild } : {}),
    ...(prebuild.length > 0 && config.env ? { env: config.env } : {}),
    ...(prebuild.length > 0 && config.workdir ? { workdir: config.workdir } : {}),
  }
  return prebuildConfig
}

export function isCurrentPrebuildClone(config: WorkenvConfig, runtimeState: WorkenvRow['runtimeState']): boolean {
  if (runtimeState?.runtime !== 'orbstack' || !runtimeState.prebuildHash) return false
  const prebuildConfig = prebuildConfigFor(config)
  return !!prebuildConfig && runtimeState.prebuildHash === prebuildCacheKeyForConfig(prebuildConfig)
}

export function prebuildCacheKeyForConfig(config: WorkenvConfig): string {
  const hasPrebuildSteps = (config.prebuild ?? []).length > 0
  return hashConfig({
    runtime: config.runtime,
    worktreePath: '<prebuild>',
    layers: prebuildableLayers(config.layers),
    base: config.base,
    ...(hasPrebuildSteps ? { env: config.env, prebuild: config.prebuild, workdir: config.workdir } : {}),
  })
}

export function sleep(ms: number): Effect.Effect<void> {
  return Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))
}

export function dedupeMounts(mounts: readonly WorkenvMount[]): WorkenvMount[] {
  const seen = new Set<string>()
  const out: WorkenvMount[] = []
  for (const mount of mounts) {
    const key = JSON.stringify({
      kind: mount.kind,
      host: mount.host ?? null,
      guest: mount.guest,
      mode: mount.mode,
      cacheKey: mount.cacheKey ?? null,
    })
    if (seen.has(key)) continue
    seen.add(key)
    out.push(mount)
  }
  return out
}

export function tailOutput(output: string): string {
  const trimmed = output.trim()
  return trimmed.length > 600 ? `…${trimmed.slice(-600)}` : trimmed
}

export function unsupportedConfigFeature(config: WorkenvConfig): string | null {
  for (const [key, value] of Object.entries(config.env ?? {})) {
    if (typeof value !== 'string') return `env.${key} uses deferred resolution, which is not implemented yet`
  }
  for (const layer of config.layers ?? []) {
    if (layer.kind === 'auth') {
      if (layer.resolveEnv && Object.keys(layer.resolveEnv).length > 0) {
        return `${layer.id}.resolveEnv is not implemented yet; use a hostScript/bootstrap step instead`
      }
      if (layer.resolveFiles && Object.keys(layer.resolveFiles).length > 0) {
        return `${layer.id}.resolveFiles is not implemented yet; use a hostScript/bootstrap step instead`
      }
    }
  }
  return null
}

export function handleForRow(row: WorkenvRow): WorkenvHandle | Error {
  if (!row.adapterHandle) return new Error(`workenv ${row.id} has no adapter handle`)
  const parsed = workenvRuntimeStateSchema.safeParse(row.runtimeState)
  if (!parsed.success) {
    return new Error(
      `workenv ${row.id} has invalid runtime state: ${parsed.error.issues[0]?.message ?? 'unknown error'}`,
    )
  }
  if (parsed.data.runtime !== row.runtime) {
    return new Error(`workenv ${row.id} runtime state is for ${parsed.data.runtime}, not ${row.runtime}`)
  }
  return { runtime: row.runtime, adapterHandle: row.adapterHandle, state: parsed.data }
}

function isStaleCompiledBootstrapStep(step: BootstrapStep): boolean {
  const key = step.kind !== 'recipe' ? step.idempotencyKey : undefined
  if (!key) return false

  return (
    /^tool:[^:]+:install:/.test(key) ||
    /^pkg:[^:]+:install(?::|$)/.test(key) ||
    /^service:[^:]+:start$/.test(key) ||
    /^auth:[^:]+:resolveFile:/.test(key) ||
    key === 'base:apt-essentials' ||
    key === 'base:create-user' ||
    key === 'base:user-sudoers' ||
    /^base:[^:]+:install:/.test(key)
  )
}

export function userBootstrapSteps(config: WorkenvConfig): NonNullable<WorkenvConfig['bootstrap']> {
  const steps = config.bootstrap ?? []
  if ((config.layers ?? []).length === 0) return steps
  return steps.filter((step) => !isStaleCompiledBootstrapStep(step))
}

export function postStartSteps(config: WorkenvConfig): NonNullable<WorkenvConfig['postStart']> {
  return config.postStart ?? []
}

export function stepsForPrebuildState(
  steps: readonly BootstrapStep[],
  clonedFromPrebuild: boolean,
): readonly BootstrapStep[] {
  if (!clonedFromPrebuild) return steps
  return steps.filter((step) => step.kind === 'recipe' || !step.skipWhenPrebuilt)
}

export function prebuildSteps(config: WorkenvConfig): NonNullable<WorkenvConfig['prebuild']> {
  return config.prebuild ?? []
}

export function stripStaleCompiledBootstrap(config: WorkenvConfig): WorkenvConfig {
  if ((config.layers ?? []).length === 0 || !config.bootstrap) return config
  const bootstrap = userBootstrapSteps(config)
  return {
    ...config,
    ...(bootstrap.length > 0 ? { bootstrap } : { bootstrap: undefined }),
  }
}
