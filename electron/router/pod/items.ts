import { z } from 'zod'
import { PodItemController } from '../../services'
import type { AppRouterDeps } from '../index'

export function podItemRoutes({ effectOs }: AppRouterDeps) {
  return {
    list: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodItemController
      return yield* svc.listByPod(input.podId)
    }),

    getById: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodItemController
      return yield* svc.getById(input.id)
    }),

    create: effectOs
      .input(
        z.object({
          podId: z.string(),
          contentType: z.enum(['terminal', 'browser', 'markdown']),
          label: z.string(),
          config: z.union([
            z.object({ podTerminalId: z.string() }),
            z.object({ url: z.string() }),
            z.object({ filePath: z.string() }),
          ]),
          sortOrder: z.number().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* PodItemController
        return yield* svc.create(input)
      }),

    update: effectOs
      .input(
        z.object({
          id: z.string(),
          label: z.string().optional(),
          labelSource: z.string().optional(),
          sortOrder: z.number().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* PodItemController
        const { id, ...data } = input
        return yield* svc.update(id, data)
      }),

    updateConfig: effectOs
      .input(
        z.object({
          id: z.string(),
          config: z.union([
            z.object({ podTerminalId: z.string() }),
            z.object({ url: z.string() }),
            z.object({ filePath: z.string() }),
          ]),
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* PodItemController
        return yield* svc.updateConfig(input.id, input.config)
      }),

    delete: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodItemController
      return yield* svc.delete(input.id)
    }),
  }
}
