import { z } from 'zod'
import { SettingsController } from '../../services'
import type { AppRouterDeps } from '../index'

export function settingsRoutes({ effectOs }: AppRouterDeps) {
  return {
    get: effectOs.input(z.object({ key: z.string() })).effect(function* ({ input }) {
      const svc = yield* SettingsController
      return yield* svc.get(input.key)
    }),

    getMany: effectOs.input(z.object({ keys: z.array(z.string()) })).effect(function* ({ input }) {
      const svc = yield* SettingsController
      return yield* svc.getMany(input.keys)
    }),

    set: effectOs.input(z.object({ key: z.string(), value: z.string().nullable() })).effect(function* ({ input }) {
      const svc = yield* SettingsController
      return yield* svc.set(input.key, input.value)
    }),
  }
}
