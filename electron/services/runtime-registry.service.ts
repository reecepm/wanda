// -----------------------------------------------------------------------------
// RuntimeRegistry — set of runtime adapters keyed by `WorkenvRuntime`,
// with a probe-result cache (default 5s TTL).
//
// The class itself is sync and dep-free for unit testing; the Effect
// service tag + Live layer wrap a single instance so the controller can
// pull it via dependency injection.
//
// Probes are throttled because:
//   - the underlying CLI calls (`orb status`) take 100s of ms each and
//     frontends will refetch on every render;
//   - capability/availability for the same adapter doesn't change second
//     to second.
//
// Cache invalidation is manual: `invalidate(runtime?)`. The 5s TTL is the
// upper bound; callers wanting a fresh result (e.g. after the user clicks
// "Reinstall OrbStack") should `invalidate()` first.
// -----------------------------------------------------------------------------

import { Context, Effect, Layer } from 'effect'
import type { WorkenvRuntime } from '../../shared/contracts/workenv'
import { OrbstackAdapter } from '../domains/workenv/adapters/orbstack'
import type { ProbeResult, RuntimeAdapter } from '../domains/workenv/types/adapter'
import { PtyService } from './pty.service'

const DEFAULT_PROBE_TTL_MS = 5000

export interface RuntimeRegistryOptions {
  readonly adapters: readonly RuntimeAdapter[]
  readonly probeTtlMs?: number
  readonly now?: () => number
}

interface CacheEntry {
  readonly value: ProbeResult
  readonly expiresAt: number
}

export class RuntimeRegistry {
  private readonly adapters = new Map<WorkenvRuntime, RuntimeAdapter>()
  private readonly order: RuntimeAdapter[] = []
  private readonly cache = new Map<WorkenvRuntime, CacheEntry>()
  private readonly probeTtlMs: number
  private readonly now: () => number

  constructor(opts: RuntimeRegistryOptions) {
    this.probeTtlMs = opts.probeTtlMs ?? DEFAULT_PROBE_TTL_MS
    this.now = opts.now ?? (() => Date.now())
    for (const a of opts.adapters) {
      this.adapters.set(a.id, a)
      this.order.push(a)
    }
  }

  get(runtime: WorkenvRuntime): RuntimeAdapter | undefined {
    return this.adapters.get(runtime)
  }

  list(): readonly RuntimeAdapter[] {
    return this.order
  }

  probe(runtime: WorkenvRuntime): Effect.Effect<ProbeResult> {
    return Effect.gen(this, function* () {
      const cached = this.cache.get(runtime)
      const t = this.now()
      if (cached && cached.expiresAt > t) {
        return cached.value
      }
      const adapter = this.adapters.get(runtime)
      if (!adapter) {
        return { available: false, error: `no adapter registered for runtime '${runtime}'` }
      }
      const result = yield* adapter.probe()
      this.cache.set(runtime, { value: result, expiresAt: t + this.probeTtlMs })
      return result
    })
  }

  probeAll(): Effect.Effect<Record<WorkenvRuntime, ProbeResult>> {
    return Effect.gen(this, function* () {
      const out: Partial<Record<WorkenvRuntime, ProbeResult>> = {}
      for (const a of this.order) {
        out[a.id] = yield* this.probe(a.id)
      }
      return out as Record<WorkenvRuntime, ProbeResult>
    })
  }

  invalidate(runtime?: WorkenvRuntime): void {
    if (runtime) this.cache.delete(runtime)
    else this.cache.clear()
  }
}

// --- Effect service tag + Live layer ---------------------------------------

export class RuntimeRegistryService extends Context.Tag('RuntimeRegistryService')<
  RuntimeRegistryService,
  RuntimeRegistry
>() {}

export function makeRuntimeRegistryLive(opts: RuntimeRegistryOptions): Layer.Layer<RuntimeRegistryService> {
  return Layer.sync(RuntimeRegistryService, () => new RuntimeRegistry(opts))
}

/**
 * Boot-time registry factory used by the AppLayer. Reads `WANDA_FAKE_RUNTIME=1`
 * to swap in the FakeRuntimeAdapter (e2e + standalone test runs); otherwise
 * registers the real OrbStack adapter.
 *
 * Adapter registration here, not the controller's responsibility — the
 * controller just looks up `registry.get(runtime)`.
 */
export function makeRuntimeRegistryFromEnv(): Layer.Layer<RuntimeRegistryService, never, PtyService> {
  if (process.env.WANDA_FAKE_RUNTIME === '1') {
    // Lazy import so production bundles don't pull in the test adapter.
    return Layer.effect(
      RuntimeRegistryService,
      Effect.promise(async () => {
        const { FakeRuntimeAdapter } = await import('../testing/fake-runtime-adapter')
        return new RuntimeRegistry({
          adapters: [new FakeRuntimeAdapter({ runtime: 'orbstack' })],
        })
      }),
    )
  }
  return Layer.effect(
    RuntimeRegistryService,
    Effect.gen(function* () {
      const pty = yield* PtyService
      return new RuntimeRegistry({
        adapters: [new OrbstackAdapter({ pty })],
      })
    }),
  )
}
