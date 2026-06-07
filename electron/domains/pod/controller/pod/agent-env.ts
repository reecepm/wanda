import path from 'node:path'
import type { Context } from 'effect'
import { APP_DOT_DIR } from '../../../../app-config'
import { globalBinPath } from '../../../../packages/agent-commands'
import {
  type AgentStatusService,
  injectClaudeHooks,
  injectCodexHooks,
  injectOpenCodePlugin,
} from '../../../../packages/agent-hooks'
import { buildAgentTerminalMcpEnv } from '../../../../packages/agent-mcp'
import { log } from '../../../../packages/logger'
import type { AgentType } from '../../types'
import type { PodRuntimeState } from './state'

type AgentStatusSvc = Context.Tag.Service<typeof AgentStatusService>

/** Inputs that vary per pod/terminal but not per controller instance. */
export interface AgentEnvParams {
  readonly terminalId: string
  readonly agentType: AgentType
  readonly isDocker: boolean
  readonly includeWandaMcp: boolean
}

/**
 * Build the Wanda-specific env vars for an agent terminal. This is the Phase-1
 * hook-token wiring: `WANDA_HOOK_TOKEN` authenticates the agent's webhook back
 * to the local server, and `WANDA_HTTP_PORT` / `WANDA_HTTP_HOST` point it at the
 * status endpoint (host loopback, or `host.docker.internal` from inside a
 * container). Returns `undefined` when the HTTP port / token are not ready so
 * callers fall back to a bare terminal.
 */
export function buildAgentTerminalEnv(state: PodRuntimeState, params: AgentEnvParams): Record<string, string> {
  const { terminalId, agentType, isDocker, includeWandaMcp } = params
  const { httpPort, hookToken } = state
  const portFilePath = isDocker ? '/opt/wanda/mcp-port' : path.join(APP_DOT_DIR, 'mcp-port')
  return {
    PATH: globalBinPath(),
    WANDA_TERMINAL_ID: terminalId,
    WANDA_AGENT_TYPE: agentType,
    WANDA_PORT_FILE: portFilePath,
    ...(httpPort ? { WANDA_HTTP_PORT: String(httpPort) } : {}),
    WANDA_HTTP_HOST: isDocker ? 'host.docker.internal' : '127.0.0.1',
    ...(hookToken ? { WANDA_HOOK_TOKEN: hookToken } : {}),
    ...(includeWandaMcp && httpPort ? buildAgentTerminalMcpEnv(agentType, httpPort) : {}),
  }
}

/** Resolve the Claude status-hook URL for a pod, or null if the port isn't ready. */
export function claudeHookUrl(state: PodRuntimeState, isDocker: boolean): string | null {
  const host = isDocker ? 'host.docker.internal' : '127.0.0.1'
  return state.httpPort ? `http://${host}:${state.httpPort}/agent-status` : null
}

/**
 * Register an agent terminal with the status service and inject the
 * agent-specific hooks into the pod cwd, collecting their cleanup functions.
 */
export function injectAgentHooks(
  agentStatusSvc: AgentStatusSvc,
  cleanups: (() => void)[],
  params: {
    terminalId: string
    agentType: AgentType
    cwd: string
    isDocker: boolean
    claudeHookUrl: string | null
  },
): void {
  const { terminalId, agentType, cwd, claudeHookUrl: hookUrl } = params
  agentStatusSvc.register(terminalId, agentType, cwd)
  try {
    if (agentType === 'claude') {
      if (!hookUrl) {
        log.pod.warn(`Skipping Claude hook injection for terminal ${terminalId}: HTTP port not ready`)
      } else {
        cleanups.push(injectClaudeHooks(cwd, { httpUrl: hookUrl }))
      }
    } else if (agentType === 'codex') {
      cleanups.push(injectCodexHooks(cwd))
    } else if (agentType === 'opencode') {
      cleanups.push(injectOpenCodePlugin(cwd))
    }
  } catch (err) {
    log.pod.warn(`Failed to inject ${agentType} hooks for terminal ${terminalId}:`, err)
  }
}
