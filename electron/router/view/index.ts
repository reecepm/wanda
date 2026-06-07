import { z } from 'zod'
import { viewConfigSchema, viewItemSettingsSchema } from '../../domains/view/schemas'
import { ViewController } from '../../services'
import type { AppRouterDeps } from '../index'

export function viewRoutes({ effectOs }: AppRouterDeps) {
  return {
    listByPod: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const svc = yield* ViewController
      return yield* svc.listByPod(input.podId)
    }),

    getById: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* ViewController
      return yield* svc.getById(input.id)
    }),

    create: effectOs
      .input(
        z.object({
          podId: z.string(),
          name: z.string(),
          viewType: z.string().optional(),
          config: viewConfigSchema.optional(),
          itemSettings: z.record(z.string(), viewItemSettingsSchema).optional(),
          sortOrder: z.number().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* ViewController
        return yield* svc.create(input)
      }),

    update: effectOs
      .input(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          config: viewConfigSchema.optional(),
          itemSettings: z.record(z.string(), viewItemSettingsSchema).optional(),
          sortOrder: z.number().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* ViewController
        const { id, ...data } = input
        return yield* svc.update(id, data)
      }),

    delete: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* ViewController
      return yield* svc.delete(input.id)
    }),

    applyTemplate: effectOs.input(z.object({ templateId: z.string(), podId: z.string() })).effect(function* ({
      input,
    }) {
      const svc = yield* ViewController
      return yield* svc.applyTemplate(input.templateId, input.podId)
    }),

    ensureDefault: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const svc = yield* ViewController
      return yield* svc.ensureDefaultView(input.podId)
    }),
  }
}
