import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '../../../db/connection'
import { permissionPolicies } from '../../../db/schema'
import type { PermissionPolicyDecision, PermissionPolicyInsert, PermissionPolicyRow, ToolKindOrAny } from '../types'

export type PermissionPolicyDbRow = typeof permissionPolicies.$inferSelect

export function rowToDomain(row: PermissionPolicyDbRow): PermissionPolicyRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    providerId: row.providerId,
    toolKind: row.toolKind as ToolKindOrAny,
    toolName: row.toolName,
    locationPattern: row.locationPattern,
    decision: row.decision as PermissionPolicyDecision,
    createdBySessionId: row.createdBySessionId,
    expiresAt: row.expiresAt == null ? null : row.expiresAt.getTime(),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

export function listPoliciesByWorkspace(db: AppDatabase, workspaceId: string): PermissionPolicyRow[] {
  return db
    .select()
    .from(permissionPolicies)
    .where(eq(permissionPolicies.workspaceId, workspaceId))
    .all()
    .map(rowToDomain)
}

export function findPolicyById(db: AppDatabase, id: string): PermissionPolicyRow | null {
  const row = db.select().from(permissionPolicies).where(eq(permissionPolicies.id, id)).get()
  return row ? rowToDomain(row) : null
}

export function listPolicyRowsByWorkspaceProvider(
  db: AppDatabase,
  input: { workspaceId: string; providerId: string },
): PermissionPolicyDbRow[] {
  return db
    .select()
    .from(permissionPolicies)
    .where(
      and(eq(permissionPolicies.workspaceId, input.workspaceId), eq(permissionPolicies.providerId, input.providerId)),
    )
    .all()
}

export function upsertPolicy(db: AppDatabase, input: PermissionPolicyInsert): string {
  const toolName = input.toolName ?? '*'
  const locationPattern = input.locationPattern ?? '**'
  const now = new Date()
  const existing = db
    .select({ id: permissionPolicies.id })
    .from(permissionPolicies)
    .where(
      and(
        eq(permissionPolicies.workspaceId, input.workspaceId),
        eq(permissionPolicies.providerId, input.providerId),
        eq(permissionPolicies.toolKind, input.toolKind),
        eq(permissionPolicies.toolName, toolName),
        eq(permissionPolicies.locationPattern, locationPattern),
      ),
    )
    .get()

  if (existing) {
    db.update(permissionPolicies)
      .set({
        decision: input.decision,
        createdBySessionId: input.createdBySessionId ?? null,
        expiresAt: input.expiresAt == null ? null : new Date(input.expiresAt),
        updatedAt: now,
      })
      .where(eq(permissionPolicies.id, existing.id))
      .run()
    return existing.id
  }

  const id = globalThis.crypto.randomUUID()
  db.insert(permissionPolicies)
    .values({
      id,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      toolKind: input.toolKind,
      toolName,
      locationPattern,
      decision: input.decision,
      createdBySessionId: input.createdBySessionId ?? null,
      expiresAt: input.expiresAt == null ? null : new Date(input.expiresAt),
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return id
}

export function deletePolicy(db: AppDatabase, id: string): boolean {
  const result = db.delete(permissionPolicies).where(eq(permissionPolicies.id, id)).run()
  return result.changes > 0
}
