// -----------------------------------------------------------------------------
// ToolKind enum.
//
// Mirrors ACP's tool-kind vocabulary. Consumed by `tool-detail.ts` and
// `event.ts`; split into its own file to avoid circular imports.
// -----------------------------------------------------------------------------

import { z } from 'zod'

export const TOOL_KINDS = [
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'terminal',
  'other',
] as const

export type ToolKind = (typeof TOOL_KINDS)[number]

export const ToolKindSchema = z.enum(TOOL_KINDS)
