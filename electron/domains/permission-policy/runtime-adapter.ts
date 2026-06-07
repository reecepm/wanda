import type { PermissionRequest, ToolCallDetail, ToolKind } from '@wanda/agent-protocol'
import type {
  PermissionPolicyContext,
  PermissionPolicySaveInput,
  PermissionPolicyStore as RuntimePermissionPolicyStore,
} from '@wanda/agent-runtime'
import type { AppDatabase } from '../../db/connection'
import { log } from '../../packages/logger'
import { listPolicyRowsByWorkspaceProvider, type PermissionPolicyDbRow, upsertPolicy } from './repository'
import type { PermissionPolicyDecision, ToolKindOrAny } from './types'

interface PolicyKey {
  readonly toolKind: ToolKindOrAny
  readonly toolName: string
  readonly location: string
  readonly locationPattern: string
}

export function makeRuntimePermissionPolicyStore(db: AppDatabase): RuntimePermissionPolicyStore {
  return {
    resolve(input) {
      if (!input.workspaceId) return null
      const key = policyKeyForRequest(input)
      const now = new Date()
      try {
        const rows = listPolicyRowsByWorkspaceProvider(db, {
          workspaceId: input.workspaceId,
          providerId: input.providerId,
        })
        const match = rows.find((row) => isActive(row, now) && matches(row, key))
        if (!match) return null
        const decision = match.decision as PermissionPolicyDecision
        if (decision.behaviour === 'allow') return { behaviour: 'allow', scope: 'always' }
        return {
          behaviour: 'deny',
          scope: 'always',
          message: decision.message,
        }
      } catch (err) {
        log.agent.warn('permissionPolicies.resolve failed', { sessionId: input.sessionId, err })
        return null
      }
    },

    save(input) {
      if (!input.workspaceId) return
      const key = policyKeyForRequest(input)
      const decision: PermissionPolicyDecision =
        input.decision.behaviour === 'allow'
          ? { behaviour: 'allow' }
          : { behaviour: 'deny', message: input.decision.message }
      try {
        upsertPolicy(db, {
          workspaceId: input.workspaceId,
          providerId: input.providerId,
          toolKind: key.toolKind,
          toolName: key.toolName,
          locationPattern: key.locationPattern,
          decision,
          createdBySessionId: input.sessionId as string,
          expiresAt: null,
        })
      } catch (err) {
        log.agent.warn('permissionPolicies.save failed', { sessionId: input.sessionId, err })
      }
    },
  }
}

function isActive(row: PermissionPolicyDbRow, now: Date): boolean {
  return row.expiresAt == null || row.expiresAt.getTime() > now.getTime()
}

function matches(row: PermissionPolicyDbRow, key: PolicyKey): boolean {
  const rowKind = row.toolKind as ToolKindOrAny
  const rowName = row.toolName || '*'
  const rowPattern = row.locationPattern || '**'
  if (rowKind !== '*' && rowKind !== key.toolKind) return false
  if (rowName !== '*' && rowName !== key.toolName) return false
  return locationMatches(rowPattern, key.location)
}

function locationMatches(pattern: string, location: string): boolean {
  if (pattern === '*' || pattern === '**') return true
  if (pattern.endsWith('/**')) return location.startsWith(pattern.slice(0, -3))
  return pattern === location
}

function policyKeyForRequest(input: PermissionPolicyContext | PermissionPolicySaveInput): PolicyKey {
  const request = input.request
  if (request.kind !== 'tool') {
    return {
      toolKind: 'other',
      toolName: request.kind,
      location: input.cwd,
      locationPattern: '**',
    }
  }

  const detail = request.detail
  const toolKind = toolKindForDetail(detail.kind)
  const toolName = detail.kind === 'other' ? detail.toolName : detail.kind
  const location = locationForRequest(request, input.cwd)
  return {
    toolKind,
    toolName,
    location,
    locationPattern: location,
  }
}

function toolKindForDetail(kind: ToolCallDetail['kind']): ToolKind {
  switch (kind) {
    case 'shell':
      return 'execute'
    case 'diff':
      return 'edit'
    case 'read':
      return 'read'
    case 'search':
      return 'search'
    case 'fetch':
      return 'fetch'
    case 'terminal':
      return 'terminal'
    case 'think':
      return 'think'
    case 'other':
      return 'other'
  }
}

function locationForRequest(request: Extract<PermissionRequest, { kind: 'tool' }>, fallback: string): string {
  const detail = request.detail
  switch (detail.kind) {
    case 'shell':
      return detail.cwd ?? fallback
    case 'diff':
    case 'read':
      return detail.path
    case 'search':
      return detail.scope ?? fallback
    case 'fetch':
      return detail.url
    default:
      return fallback
  }
}
