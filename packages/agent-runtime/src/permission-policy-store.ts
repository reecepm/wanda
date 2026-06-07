import type { Decision, PermissionRequest, SessionId } from '@wanda/agent-protocol'

export interface PermissionPolicyContext {
  readonly sessionId: SessionId
  readonly providerId: string
  readonly workspaceId: string | null
  readonly cwd: string
  readonly request: PermissionRequest
}

export interface PermissionPolicySaveInput extends PermissionPolicyContext {
  readonly decision: Decision
}

export interface PermissionPolicyStore {
  readonly resolve: (input: PermissionPolicyContext) => Decision | null
  readonly save: (input: PermissionPolicySaveInput) => void
}
