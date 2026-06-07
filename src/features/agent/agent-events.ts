import type { ApprovalRequest } from '@/features/agent/store/agent-store'

export interface AgentProviderModel {
  id: string
  displayName: string
  isDefault?: boolean
}

export interface AgentStatusInfo {
  status: string
  agentType: string
  sessionId?: string
  errorDetail?: string
  exitCode?: number
  exitOutput?: string
}

export function onAgentMessage(callback: (sessionId: string, message: unknown) => void) {
  return window.wanda.agent.onMessage(callback)
}

export function onAgentPermissionRequest(callback: (request: ApprovalRequest) => void) {
  return window.wanda.agent.onPermissionRequest((request) => {
    callback(request as ApprovalRequest)
  })
}

export function onAgentPermissionResolved(callback: () => void) {
  return window.wanda.agent.onPermissionResolved(callback)
}

export function onAgentAuthRequired(callback: (authUrl: string) => void) {
  return window.wanda.agent.onAuthRequired(callback)
}

export function onAgentModelsLoaded(callback: (models: AgentProviderModel[]) => void) {
  return window.wanda.agent.onModelsLoaded(callback)
}

export function onAgentReady(callback: () => void) {
  return window.wanda.agent.onReady(callback)
}

export function onAgentStatusChange(callback: (terminalId: string, status: AgentStatusInfo) => void) {
  return window.wanda.agent.onStatusChange(callback)
}
