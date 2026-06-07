import { z } from 'zod'
import { AgentConfigController } from '../../services'
import type { AppRouterDeps } from '../index'

const agentTypeSchema = z.enum(['claude', 'codex', 'opencode'])
const scopeSchema = z.enum(['global', 'workspace', 'pod'])

const claudeConfigSchema = z.object({
  flags: z.record(z.string(), z.boolean()).optional(),
  extraArgs: z.array(z.string()).optional(),
})

/** Polymorphic per-agent config shape. Flags are provider-specific by id. */
const configPayloadSchema = claudeConfigSchema

export function agentConfigRoutes({ effectOs }: AppRouterDeps) {
  return {
    get: effectOs
      .input(
        z.object({
          scope: scopeSchema,
          scopeId: z.string().nullable(),
          agentType: agentTypeSchema,
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* AgentConfigController
        return yield* svc.get(input.scope, input.scopeId, input.agentType)
      }),

    set: effectOs
      .input(
        z.object({
          scope: scopeSchema,
          scopeId: z.string().nullable(),
          agentType: agentTypeSchema,
          config: configPayloadSchema,
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* AgentConfigController
        yield* svc.set(input.scope, input.scopeId, input.agentType, input.config)
      }),

    clear: effectOs
      .input(
        z.object({
          scope: scopeSchema,
          scopeId: z.string().nullable(),
          agentType: agentTypeSchema,
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* AgentConfigController
        yield* svc.clear(input.scope, input.scopeId, input.agentType)
      }),

    resolveForPod: effectOs.input(z.object({ podId: z.string(), agentType: agentTypeSchema })).effect(function* ({
      input,
    }) {
      const svc = yield* AgentConfigController
      return yield* svc.resolveForPod(input.podId, input.agentType)
    }),
  }
}
