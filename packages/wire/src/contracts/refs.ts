// -----------------------------------------------------------------------------
// GENERATED FILE — edit `scripts/gen-refs.ts` (source: `contracts/resources.ts`)
// and re-run `bun run gen:refs`. Hand edits will be clobbered.
//
// Branded types + ResourceRef + per-kind Zod validators + factory functions.
// Every downstream package imports brands from here; the ESLint rule
// `no-local-branded-types` prevents accidental re-declaration elsewhere.
// -----------------------------------------------------------------------------

import { z } from 'zod'
import type { ResourceKind } from './resources.ts'

// --- Branded id types ----------------------------------------------------------

declare const PodIdBrand: unique symbol
export type PodId = string & { readonly [PodIdBrand]: never }

declare const WorkspaceIdBrand: unique symbol
export type WorkspaceId = string & { readonly [WorkspaceIdBrand]: never }

declare const PodItemIdBrand: unique symbol
export type PodItemId = string & { readonly [PodItemIdBrand]: never }

declare const ViewIdBrand: unique symbol
export type ViewId = string & { readonly [ViewIdBrand]: never }

declare const AgentIdBrand: unique symbol
export type AgentId = string & { readonly [AgentIdBrand]: never }

declare const AgentSessionIdBrand: unique symbol
export type AgentSessionId = string & { readonly [AgentSessionIdBrand]: never }

declare const CommandIdBrand: unique symbol
export type CommandId = string & { readonly [CommandIdBrand]: never }

declare const PortIdBrand: unique symbol
export type PortId = string & { readonly [PortIdBrand]: never }

declare const TerminalIdBrand: unique symbol
export type TerminalId = string & { readonly [TerminalIdBrand]: never }

// --- ResourceRef generic + per-kind aliases -----------------------------------

export interface ResourceRef<Kind extends ResourceKind, Id extends string> {
  readonly serverId: string
  readonly kind: Kind
  readonly id: Id
}

export type PodRef = ResourceRef<'pod', PodId>
export type WorkspaceRef = ResourceRef<'workspace', WorkspaceId>
export type PodItemRef = ResourceRef<'podItem', PodItemId>
export type ViewRef = ResourceRef<'view', ViewId>
export type AgentRef = ResourceRef<'agent', AgentId>
export type AgentSessionRef = ResourceRef<'agentSession', AgentSessionId>
export type CommandRef = ResourceRef<'command', CommandId>
export type PortRef = ResourceRef<'port', PortId>
export type TerminalRef = ResourceRef<'terminal', TerminalId>

export interface ResourceRefMap {
  pod: PodRef
  workspace: WorkspaceRef
  podItem: PodItemRef
  view: ViewRef
  agent: AgentRef
  agentSession: AgentSessionRef
  command: CommandRef
  port: PortRef
  terminal: TerminalRef
}

export type AnyResourceRef = ResourceRefMap[keyof ResourceRefMap]

// --- Factories ----------------------------------------------------------------

const nonEmptyServerId = (serverId: string) => {
  if (typeof serverId !== 'string' || serverId.length === 0) {
    throw new Error('serverId must be a non-empty string')
  }
  return serverId
}

const nonEmptyId = (id: string) => {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('id must be a non-empty string')
  }
  return id
}

export const podRef = (serverId: string, id: string): PodRef => ({
  serverId: nonEmptyServerId(serverId),
  kind: 'pod',
  id: nonEmptyId(id) as PodId,
})

export const workspaceRef = (serverId: string, id: string): WorkspaceRef => ({
  serverId: nonEmptyServerId(serverId),
  kind: 'workspace',
  id: nonEmptyId(id) as WorkspaceId,
})

export const podItemRef = (serverId: string, id: string): PodItemRef => ({
  serverId: nonEmptyServerId(serverId),
  kind: 'podItem',
  id: nonEmptyId(id) as PodItemId,
})

export const viewRef = (serverId: string, id: string): ViewRef => ({
  serverId: nonEmptyServerId(serverId),
  kind: 'view',
  id: nonEmptyId(id) as ViewId,
})

export const agentRef = (serverId: string, id: string): AgentRef => ({
  serverId: nonEmptyServerId(serverId),
  kind: 'agent',
  id: nonEmptyId(id) as AgentId,
})

export const agentSessionRef = (serverId: string, id: string): AgentSessionRef => ({
  serverId: nonEmptyServerId(serverId),
  kind: 'agentSession',
  id: nonEmptyId(id) as AgentSessionId,
})

export const commandRef = (serverId: string, id: string): CommandRef => ({
  serverId: nonEmptyServerId(serverId),
  kind: 'command',
  id: nonEmptyId(id) as CommandId,
})

export const portRef = (serverId: string, id: string): PortRef => ({
  serverId: nonEmptyServerId(serverId),
  kind: 'port',
  id: nonEmptyId(id) as PortId,
})

export const terminalRef = (serverId: string, id: string): TerminalRef => ({
  serverId: nonEmptyServerId(serverId),
  kind: 'terminal',
  id: nonEmptyId(id) as TerminalId,
})

// --- Zod validators -----------------------------------------------------------

const baseRefShape = {
  serverId: z.string().min(1),
  id: z.string().min(1),
}

export const PodRefSchema = z.object({ ...baseRefShape, kind: z.literal('pod') })
export const WorkspaceRefSchema = z.object({ ...baseRefShape, kind: z.literal('workspace') })
export const PodItemRefSchema = z.object({ ...baseRefShape, kind: z.literal('podItem') })
export const ViewRefSchema = z.object({ ...baseRefShape, kind: z.literal('view') })
export const AgentRefSchema = z.object({ ...baseRefShape, kind: z.literal('agent') })
export const AgentSessionRefSchema = z.object({ ...baseRefShape, kind: z.literal('agentSession') })
export const CommandRefSchema = z.object({ ...baseRefShape, kind: z.literal('command') })
export const PortRefSchema = z.object({ ...baseRefShape, kind: z.literal('port') })
export const TerminalRefSchema = z.object({ ...baseRefShape, kind: z.literal('terminal') })

export const RefSchemaByKind = {
  pod: PodRefSchema,
  workspace: WorkspaceRefSchema,
  podItem: PodItemRefSchema,
  view: ViewRefSchema,
  agent: AgentRefSchema,
  agentSession: AgentSessionRefSchema,
  command: CommandRefSchema,
  port: PortRefSchema,
  terminal: TerminalRefSchema,
} as const satisfies Record<ResourceKind, z.ZodType>

export const AnyRefSchema = z.discriminatedUnion('kind', [
  PodRefSchema,
  WorkspaceRefSchema,
  PodItemRefSchema,
  ViewRefSchema,
  AgentRefSchema,
  AgentSessionRefSchema,
  CommandRefSchema,
  PortRefSchema,
  TerminalRefSchema,
])

// --- Runtime helpers ----------------------------------------------------------

/**
 * Validate an unknown value as a ResourceRef of any known kind.
 * Returns null on failure (never throws) — callers decide how to surface.
 */
export function parseRef(value: unknown): AnyResourceRef | null {
  const result = AnyRefSchema.safeParse(value)
  return result.success ? (result.data as AnyResourceRef) : null
}

/**
 * Type-level narrowing for a specific kind. Runtime + compile-time safe.
 */
export function isRefOfKind<K extends ResourceKind>(value: unknown, kind: K): value is ResourceRefMap[K] {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { kind?: unknown }
  if (candidate.kind !== kind) return false
  return RefSchemaByKind[kind].safeParse(value).success
}
