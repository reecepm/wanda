// -----------------------------------------------------------------------------
// Single source of truth for resource kinds.
//
// Everything else in this package that discriminates on kind — branded types,
// Zod validators, factory functions — is derived from RESOURCE_KINDS.
// Adding a new resource class is a one-line change here plus a re-run of
// `bun run gen:refs`.
// -----------------------------------------------------------------------------

export const RESOURCE_KINDS = [
  'pod',
  'workspace',
  'podItem',
  'view',
  'agent',
  'agentSession',
  'command',
  'port',
  'terminal',
] as const

export type ResourceKind = (typeof RESOURCE_KINDS)[number]

export function isResourceKind(value: unknown): value is ResourceKind {
  return typeof value === 'string' && (RESOURCE_KINDS as readonly string[]).includes(value)
}
