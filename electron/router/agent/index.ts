import { z } from 'zod'
import { AgentController, AgentStatusService, NotificationController } from '../../services'
import type { AppRouterDeps } from '../index'

export function agentRoutes({ effectOs, orpc, agentState }: AppRouterDeps) {
  return {
    startSession: effectOs
      .input(z.object({ cwd: z.string(), developerInstructions: z.string().optional() }))
      .effect(function* ({ input }) {
        const svc = yield* AgentController
        return yield* svc.startSession(input)
      }),

    sendMessage: effectOs
      .input(z.object({ id: z.string(), message: z.string(), model: z.string().optional() }))
      .effect(function* ({ input }) {
        const svc = yield* AgentController
        yield* svc.sendMessage(input.id, input.message, input.model)
      }),

    stopSession: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* AgentController
      yield* svc.stopSession(input.id)
    }),

    list: effectOs.effect(function* () {
      const svc = yield* AgentController
      return yield* svc.list()
    }),

    respondToPermission: effectOs
      .input(z.object({ requestId: z.number(), decision: z.enum(['accept', 'acceptForSession', 'decline']) }))
      .effect(function* ({ input }) {
        const svc = yield* AgentController
        svc.resolvePermission(input.requestId, input.decision)
        const notifSvc = yield* NotificationController
        yield* notifSvc.resolveByPayload('requestId', input.requestId, input.decision)
      }),

    openAuth: orpc.input(z.object({ url: z.string() })).handler(async ({ input }) => {
      const url = new URL(input.url)
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Only HTTP(S) URLs are supported')
      }
      const { shell } = await import('electron')
      await shell.openExternal(input.url)
    }),

    getState: orpc.handler(() => ({
      models: agentState?.models ?? null,
      authUrl: agentState?.authUrl ?? null,
      ready: agentState?.ready ?? false,
    })),

    getStatuses: effectOs.effect(function* () {
      const svc = yield* AgentStatusService
      return svc.getAll()
    }),
  }
}
