import { and, eq } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import type { AppDatabase } from '../../../db/connection'
import { type AgentConfigPayload, agentConfigs, pods } from '../../../db/schema'
import type { AgentType } from '../../pod/types'

export type { AgentConfigPayload }

export type AgentConfigScope = 'global' | 'workspace' | 'pod'

/** Sentinel used in the `scope_id` column for global-scope rows. */
const GLOBAL_SCOPE_ID = '__global__'

function resolveScopeId(scope: AgentConfigScope, scopeId: string | null): string {
  return scope === 'global' ? GLOBAL_SCOPE_ID : (scopeId ?? GLOBAL_SCOPE_ID)
}

export function getAgentConfig(
  db: AppDatabase,
  scope: AgentConfigScope,
  scopeId: string | null,
  agentType: AgentType,
): AgentConfigPayload | null {
  const row = db
    .select()
    .from(agentConfigs)
    .where(
      and(
        eq(agentConfigs.scope, scope),
        eq(agentConfigs.scopeId, resolveScopeId(scope, scopeId)),
        eq(agentConfigs.agentType, agentType),
      ),
    )
    .get()
  return row?.config ?? null
}

export function setAgentConfig(
  db: AppDatabase,
  scope: AgentConfigScope,
  scopeId: string | null,
  agentType: AgentType,
  config: AgentConfigPayload,
) {
  const sid = resolveScopeId(scope, scopeId)
  const existing = db
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.scope, scope), eq(agentConfigs.scopeId, sid), eq(agentConfigs.agentType, agentType)))
    .get()

  if (existing) {
    db.update(agentConfigs).set({ config, updatedAt: new Date() }).where(eq(agentConfigs.id, existing.id)).run()
    return
  }

  db.insert(agentConfigs)
    .values({
      id: uuid(),
      scope,
      scopeId: sid,
      agentType,
      config,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run()
}

export function clearAgentConfig(
  db: AppDatabase,
  scope: AgentConfigScope,
  scopeId: string | null,
  agentType: AgentType,
) {
  db.delete(agentConfigs)
    .where(
      and(
        eq(agentConfigs.scope, scope),
        eq(agentConfigs.scopeId, resolveScopeId(scope, scopeId)),
        eq(agentConfigs.agentType, agentType),
      ),
    )
    .run()
}

export function getWorkspaceIdForPod(db: AppDatabase, podId: string) {
  return db.select({ workspaceId: pods.workspaceId }).from(pods).where(eq(pods.id, podId)).get()?.workspaceId ?? null
}
