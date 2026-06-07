import { z } from 'zod'
import { NotificationController } from '../../services'
import type { AppRouterDeps } from '../index'

export function notificationRoutes({ effectOs }: AppRouterDeps) {
  return {
    unresolvedCounts: effectOs.effect(function* () {
      const svc = yield* NotificationController
      return yield* svc.unresolvedCounts()
    }),

    listUnresolved: effectOs.effect(function* () {
      const svc = yield* NotificationController
      return yield* svc.listUnresolved()
    }),

    listRecent: effectOs.input(z.object({ limit: z.number().optional() })).effect(function* ({ input }) {
      const svc = yield* NotificationController
      return yield* svc.listRecent(input.limit)
    }),

    markRead: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* NotificationController
      yield* svc.markRead(input.id)
    }),

    resolve: effectOs.input(z.object({ id: z.string(), resolution: z.string() })).effect(function* ({ input }) {
      const svc = yield* NotificationController
      yield* svc.resolve(input.id, input.resolution)
    }),

    dismissAll: effectOs.effect(function* () {
      const svc = yield* NotificationController
      return yield* svc.dismissAll()
    }),
  }
}
