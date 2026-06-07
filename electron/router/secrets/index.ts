// -----------------------------------------------------------------------------
// `secrets.*` oRPC router.
//
// Renderer-facing surface for storing per-provider API keys. Plaintext is
// write-only: `list` and `getStatus` only report existence + source +
// updatedAt so a compromised renderer cannot exfiltrate keys.
// -----------------------------------------------------------------------------

import { z } from 'zod'
import { SecretsService } from '../../services'
import type { AppRouterDeps } from '../index'

const ProviderIdInput = z.string().min(1).max(64)

export function secretsRoutes({ effectOs }: AppRouterDeps) {
  return {
    list: effectOs.effect(function* () {
      const svc = yield* SecretsService
      return yield* svc.listStatus()
    }),

    getStatus: effectOs.input(z.object({ providerId: ProviderIdInput })).effect(function* ({ input }) {
      const svc = yield* SecretsService
      return yield* svc.getStatus(input.providerId)
    }),

    set: effectOs
      .input(
        z.object({
          providerId: ProviderIdInput,
          plaintext: z.string().min(1).max(4096),
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* SecretsService
        yield* svc.setApiKey(input.providerId, input.plaintext)
        return yield* svc.getStatus(input.providerId)
      }),

    remove: effectOs.input(z.object({ providerId: ProviderIdInput })).effect(function* ({ input }) {
      const svc = yield* SecretsService
      yield* svc.removeApiKey(input.providerId)
      return yield* svc.getStatus(input.providerId)
    }),
  }
}
