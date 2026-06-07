import { Context, Effect, Layer } from 'effect'
import { resolveAgentCliArgs } from '../../../../shared/contracts/agent-config'
import { DatabaseService } from '../../../infra/database'
import type { AgentType } from '../../pod/types'
import {
  type AgentConfigPayload,
  type AgentConfigScope,
  clearAgentConfig,
  getAgentConfig,
  getWorkspaceIdForPod,
  setAgentConfig,
} from '../repository'

/** Default config applied when nothing is set at any level. */
const DEFAULTS: Record<AgentType, AgentConfigPayload> = {
  claude: { flags: { dangerouslySkipPermissions: false }, extraArgs: [] },
  codex: { flags: { goals: false }, extraArgs: [] },
  opencode: {},
}

function mergeConfigs(base: AgentConfigPayload, override: AgentConfigPayload | null): AgentConfigPayload {
  if (!override) return base
  return {
    ...base,
    ...override,
    flags: {
      ...(base.flags ?? {}),
      ...(override.flags ?? {}),
    },
  }
}

export function buildAgentConfigArgs(agentType: AgentType, config: AgentConfigPayload | null | undefined): string[] {
  return resolveAgentCliArgs(agentType, config)
}

interface AgentConfigControllerShape {
  readonly get: (
    scope: AgentConfigScope,
    scopeId: string | null,
    agentType: AgentType,
  ) => Effect.Effect<AgentConfigPayload | null>
  readonly set: (
    scope: AgentConfigScope,
    scopeId: string | null,
    agentType: AgentType,
    config: AgentConfigPayload,
  ) => Effect.Effect<void>
  readonly clear: (scope: AgentConfigScope, scopeId: string | null, agentType: AgentType) => Effect.Effect<void>
  /** Resolves the effective config for a pod by merging global -> workspace -> pod. */
  readonly resolveForPod: (podId: string, agentType: AgentType) => Effect.Effect<AgentConfigPayload>
}

export class AgentConfigController extends Context.Tag('AgentConfigController')<
  AgentConfigController,
  AgentConfigControllerShape
>() {}

export const AgentConfigControllerLive = Layer.effect(
  AgentConfigController,
  Effect.gen(function* () {
    const db = yield* DatabaseService

    const resolveForPod: AgentConfigControllerShape['resolveForPod'] = (podId, agentType) =>
      Effect.sync(() => {
        const workspaceId = getWorkspaceIdForPod(db, podId)

        const globalCfg = getAgentConfig(db, 'global', null, agentType)
        const workspaceCfg = workspaceId ? getAgentConfig(db, 'workspace', workspaceId, agentType) : null
        const podCfg = getAgentConfig(db, 'pod', podId, agentType)

        let resolved: AgentConfigPayload = { ...DEFAULTS[agentType] }
        resolved = mergeConfigs(resolved, globalCfg)
        resolved = mergeConfigs(resolved, workspaceCfg)
        resolved = mergeConfigs(resolved, podCfg)
        return resolved
      })

    return {
      get: (scope, scopeId, agentType) => Effect.sync(() => getAgentConfig(db, scope, scopeId, agentType)),
      set: (scope, scopeId, agentType, config) =>
        Effect.sync(() => setAgentConfig(db, scope, scopeId, agentType, config)),
      clear: (scope, scopeId, agentType) => Effect.sync(() => clearAgentConfig(db, scope, scopeId, agentType)),
      resolveForPod,
    }
  }),
)
