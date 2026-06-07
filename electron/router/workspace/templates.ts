import { z } from 'zod'
import { PodCrudController } from '../../services'
import type { AppRouterDeps } from '../index'

export function templateRoutes({ effectOs }: AppRouterDeps) {
  return {
    list: effectOs.input(z.object({ workspaceId: z.string().optional() }).optional()).effect(function* ({ input }) {
      const svc = yield* PodCrudController
      return yield* svc.listTemplates(input?.workspaceId)
    }),

    getById: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodCrudController
      return yield* svc.getById(input.id)
    }),

    create: effectOs
      .input(
        z.object({
          name: z.string(),
          description: z.string().optional(),
          workspaceId: z.string().nullable().optional(),
          cwd: z.string().optional(),
          shell: z.string().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* PodCrudController
        return yield* svc.createTemplate(input)
      }),

    createFromPod: effectOs
      .input(
        z.object({
          podId: z.string(),
          name: z.string(),
          description: z.string().optional(),
          workspaceId: z.string().nullable().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* PodCrudController
        return yield* svc.createTemplateFromPod(input.podId, {
          name: input.name,
          description: input.description,
          workspaceId: input.workspaceId,
        })
      }),

    update: effectOs
      .input(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          templateDescription: z.string().optional(),
          cwd: z.string().optional(),
          shell: z.string().optional(),
          sortOrder: z.number().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* PodCrudController
        const { id, ...data } = input
        return yield* svc.update(id, data)
      }),

    delete: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodCrudController
      return yield* svc.deletePod(input.id)
    }),
  }
}
