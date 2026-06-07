import { z } from 'zod'
import { DockerService } from '../../services'
import type { AppRouterDeps } from '../index'

export function dockerRoutes({ effectOs }: AppRouterDeps) {
  return {
    listContainers: effectOs.input(z.object({ all: z.boolean().optional() })).effect(function* ({ input }) {
      const svc = yield* DockerService
      return yield* svc.listContainers(input.all)
    }),

    listImages: effectOs.effect(function* () {
      const svc = yield* DockerService
      return yield* svc.listImages()
    }),

    startContainer: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* DockerService
      return yield* svc.startContainer(input.id)
    }),

    stopContainer: effectOs.input(z.object({ id: z.string(), timeout: z.number().optional() })).effect(function* ({
      input,
    }) {
      const svc = yield* DockerService
      return yield* svc.stopContainer(input.id, input.timeout)
    }),

    removeContainer: effectOs.input(z.object({ id: z.string(), force: z.boolean().optional() })).effect(function* ({
      input,
    }) {
      const svc = yield* DockerService
      return yield* svc.removeContainer(input.id, input.force)
    }),

    removeImage: effectOs.input(z.object({ id: z.string(), force: z.boolean().optional() })).effect(function* ({
      input,
    }) {
      const svc = yield* DockerService
      return yield* svc.removeImage(input.id, input.force)
    }),

    checkAvailable: effectOs.effect(function* () {
      const svc = yield* DockerService
      return yield* svc.checkDockerAvailable()
    }),

    containerStats: effectOs.input(z.object({ containerIds: z.array(z.string()) })).effect(function* ({ input }) {
      const svc = yield* DockerService
      return yield* svc.containerStats(input.containerIds)
    }),

    cleanupStopped: effectOs.effect(function* () {
      const svc = yield* DockerService
      const removed = yield* svc.cleanupOrphanContainers()
      return { removed }
    }),
  }
}
