// -----------------------------------------------------------------------------
// classifyConfigChange — decide whether a workenv config diff can be
// applied live, or requires a restart (stop → start) or a recreate
// (destroy → create fresh VM) to take effect.
//
// Pure function — no Effect, no I/O. Called by WorkenvController.update()
// + surfaced in the renderer so the user knows what their Save button
// will actually trigger.
//
// Rules:
//   recreate : runtime, worktreePath, resources, mounts, base.image,
//              base.arch, extends
//   restart  : env, bootstrap, postStart, layers, ports, workdir, healthcheck, requires
//   recreate : prebuild
//   live     : anything not in the above (just metadata: name today)
//
// `live` changes take effect immediately on save. `restart` changes
// require a stop+start cycle (the VM state carries over). `recreate`
// changes force a full teardown — the user has to type-confirm.
// -----------------------------------------------------------------------------

import type { WorkenvConfig } from '../../../../shared/contracts/workenv'

type ConfigChangeImpact = 'live' | 'restart' | 'recreate'

const RECREATE_KEYS: ReadonlySet<keyof WorkenvConfig> = new Set([
  'runtime',
  'worktreePath',
  'resources',
  'mounts',
  'base',
  'extends',
  'prebuild',
])

const RESTART_KEYS: ReadonlySet<keyof WorkenvConfig> = new Set([
  'env',
  'bootstrap',
  'postStart',
  'layers',
  'ports',
  'workdir',
  'healthcheck',
  'requires',
])

export interface ConfigChangeReport {
  readonly impact: ConfigChangeImpact
  readonly changedKeys: readonly (keyof WorkenvConfig)[]
  readonly recreateKeys: readonly (keyof WorkenvConfig)[]
  readonly restartKeys: readonly (keyof WorkenvConfig)[]
  readonly liveKeys: readonly (keyof WorkenvConfig)[]
}

export function classifyConfigChange(current: WorkenvConfig, next: WorkenvConfig): ConfigChangeReport {
  const keys = allConfigKeys(current, next)
  const changed: (keyof WorkenvConfig)[] = []
  const recreate: (keyof WorkenvConfig)[] = []
  const restart: (keyof WorkenvConfig)[] = []
  const live: (keyof WorkenvConfig)[] = []

  for (const k of keys) {
    if (!deepEqual(current[k], next[k])) {
      changed.push(k)
      if (RECREATE_KEYS.has(k)) recreate.push(k)
      else if (RESTART_KEYS.has(k)) restart.push(k)
      else live.push(k)
    }
  }

  const impact: ConfigChangeImpact = recreate.length > 0 ? 'recreate' : restart.length > 0 ? 'restart' : 'live'

  return {
    impact,
    changedKeys: changed,
    recreateKeys: recreate,
    restartKeys: restart,
    liveKeys: live,
  }
}

function allConfigKeys(a: WorkenvConfig, b: WorkenvConfig): (keyof WorkenvConfig)[] {
  const set = new Set<keyof WorkenvConfig>()
  for (const k of Object.keys(a) as (keyof WorkenvConfig)[]) set.add(k)
  for (const k of Object.keys(b) as (keyof WorkenvConfig)[]) set.add(k)
  return [...set]
}

/** Structural equality sufficient for JSON-friendly config values. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a === b
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao)
  const bk = Object.keys(bo)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if (!Object.hasOwn(bo, k)) return false
    if (!deepEqual(ao[k], bo[k])) return false
  }
  return true
}
