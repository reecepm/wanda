// -----------------------------------------------------------------------------
// `agent.providers.*` oRPC procedures.
//
// Read-only today: `list` (what exists) and `installed` (what is available
// in this environment). The installed probe calls `provider.detect()` to
// surface binary-missing / auth-missing states for the provider settings UI.
// -----------------------------------------------------------------------------

import { ProviderRegistry } from '@wanda/agent-runtime'
import { Effect } from 'effect'
import type { AppRouterDeps } from '../index'

function processEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

export function agentProviderRoutes({ effectOs }: AppRouterDeps) {
  return {
    list: effectOs.effect(function* () {
      const registry = yield* ProviderRegistry
      const providers = yield* registry.list
      return providers.map((p) => ({
        id: String(p.manifest.id),
        label: p.manifest.label,
        description: p.manifest.description,
        kind: p.manifest.kind,
        docsUrl: p.manifest.docsUrl,
        staticCapabilities: p.manifest.staticCapabilities,
      }))
    }),

    installed: effectOs.effect(function* () {
      const registry = yield* ProviderRegistry
      const providers = yield* registry.list
      const env = {
        platform: 'node' as const,
        isSubprocess: false,
        cwd: process.cwd(),
        env: processEnv(),
        userDataDir: process.cwd(),
      }
      const results = yield* Effect.forEach(
        providers,
        (p) =>
          Effect.map(p.detect(env), (detect) => ({
            id: String(p.manifest.id),
            label: p.manifest.label,
            available: detect.available,
            version: detect.version,
            authNeeded: detect.authNeeded ?? false,
            failureReason: detect.failureReason,
          })),
        { concurrency: 'unbounded' },
      )
      return results
    }),
  }
}
