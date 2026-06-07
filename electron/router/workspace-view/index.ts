import { z } from 'zod'
import { viewConfigSchema, viewItemSettingsSchema } from '../../domains/view/schemas'
import { WorkspaceViewController } from '../../services'
import type { AppRouterDeps } from '../index'

export function workspaceViewRoutes({ effectOs }: AppRouterDeps) {
  return {
    list: effectOs.input(z.object({ workspaceId: z.string() })).effect(function* ({ input }) {
      const svc = yield* WorkspaceViewController
      return yield* svc.listByWorkspace(input.workspaceId)
    }),

    getById: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* WorkspaceViewController
      return yield* svc.getById(input.id)
    }),

    create: effectOs
      .input(
        z.object({
          workspaceId: z.string(),
          name: z.string(),
          viewType: z.string().optional(),
          config: viewConfigSchema.optional(),
          itemSettings: z.record(z.string(), viewItemSettingsSchema).optional(),
          sortOrder: z.number().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* WorkspaceViewController
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
        const svc = yield* WorkspaceViewController
        const { id, ...data } = input
        return yield* svc.update(id, data)
      }),

    delete: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* WorkspaceViewController
      return yield* svc.delete(input.id)
    }),

    setActiveView: effectOs
      .input(z.object({ workspaceId: z.string(), viewId: z.string().nullable() }))
      .effect(function* ({ input }) {
        const svc = yield* WorkspaceViewController
        return yield* svc.setActiveView(input.workspaceId, input.viewId)
      }),

    ensureDefault: effectOs.input(z.object({ workspaceId: z.string() })).effect(function* ({ input }) {
      const svc = yield* WorkspaceViewController
      return yield* svc.ensureDefault(input.workspaceId)
    }),

    aggregatedItems: effectOs.input(z.object({ workspaceId: z.string() })).effect(function* ({ input }) {
      const svc = yield* WorkspaceViewController
      return yield* svc.aggregatedItems(input.workspaceId)
    }),

    aggregatedConfigs: effectOs.input(z.object({ workspaceId: z.string() })).effect(function* ({ input }) {
      const svc = yield* WorkspaceViewController
      return yield* svc.aggregatedConfigs(input.workspaceId)
    }),

    aggregatedRunningState: effectOs.input(z.object({ workspaceId: z.string() })).effect(function* ({ input }) {
      const svc = yield* WorkspaceViewController
      return yield* svc.aggregatedRunningState(input.workspaceId)
    }),
  }
}
