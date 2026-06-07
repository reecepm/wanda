import { z } from 'zod'
import { createTaskViewSchema, updateTaskViewSchema } from '../../domains/settings/schemas'
import { TaskViewController } from '../../services'
import type { AppRouterDeps } from '../index'

export function taskViewRoutes({ effectOs }: AppRouterDeps) {
  return {
    list: effectOs.effect(function* () {
      const svc = yield* TaskViewController
      return yield* svc.list()
    }),

    getById: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* TaskViewController
      return yield* svc.getById(input.id)
    }),

    create: effectOs.input(createTaskViewSchema).effect(function* ({ input }) {
      const svc = yield* TaskViewController
      return yield* svc.create(input)
    }),

    update: effectOs.input(updateTaskViewSchema).effect(function* ({ input }) {
      const svc = yield* TaskViewController
      const { id, ...data } = input
      return yield* svc.update(id, data)
    }),

    delete: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* TaskViewController
      yield* svc.delete(input.id)
    }),

    ensureDefaults: effectOs.effect(function* () {
      const svc = yield* TaskViewController
      return yield* svc.ensureDefaults()
    }),
  }
}
