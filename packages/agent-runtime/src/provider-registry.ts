// -----------------------------------------------------------------------------
// ProviderRegistry — static Map<ProviderId, AgentProvider>.
//
// The app's composition root registers each provider (mock, ACP, Claude SDK,
// Codex, …) at boot. The runtime looks them up by id during `create()` +
// `resume()`. No DB involvement.
// -----------------------------------------------------------------------------

import type { ProviderId } from '@wanda/agent-protocol'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { AgentProvider } from './types.ts'

export class ProviderRegistry extends Context.Tag('@wanda/ProviderRegistry')<
  ProviderRegistry,
  {
    readonly get: (providerId: ProviderId) => Effect.Effect<AgentProvider | null>
    readonly list: Effect.Effect<ReadonlyArray<AgentProvider>>
  }
>() {}

export function makeProviderRegistry(providers: ReadonlyArray<AgentProvider>) {
  const byId = new Map<string, AgentProvider>()
  for (const p of providers) byId.set(p.manifest.id as unknown as string, p)
  return {
    get(providerId: ProviderId): Effect.Effect<AgentProvider | null> {
      return Effect.sync(() => byId.get(providerId as unknown as string) ?? null)
    },
    list: Effect.sync(() => [...byId.values()]),
  }
}

export const ProviderRegistryLive = (providers: ReadonlyArray<AgentProvider>): Layer.Layer<ProviderRegistry> =>
  Layer.succeed(ProviderRegistry, ProviderRegistry.of(makeProviderRegistry(providers)))
