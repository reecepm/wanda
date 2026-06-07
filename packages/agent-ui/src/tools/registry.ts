// -----------------------------------------------------------------------------
// Tool renderer registry. Per-ToolKind React component map; consumers can
// register custom renderers for provider-specific tool names.
//
// Keyed on the `tool-<kind>` part-type string from `Part`; a `toolName`
// fallback (used when the part's kind is `other`) lets providers carve out
// bespoke UIs without widening `ToolKind` itself.
// -----------------------------------------------------------------------------

import type { Part, ToolKind, ToolPart } from '@wanda/agent-protocol'
import type { ReactNode } from 'react'

export type ToolPartType = `tool-${ToolKind}`
export type { ToolPart }

export interface ToolRendererProps {
  readonly part: ToolPart
}

export type ToolRenderer = (props: ToolRendererProps) => ReactNode

const byPartType = new Map<string, ToolRenderer>()
const byOtherName = new Map<string, ToolRenderer>()

/** Register a renderer for a tool-kind part type (e.g. `tool-execute`). */
export function registerToolRenderer(partType: ToolPartType, renderer: ToolRenderer): void {
  byPartType.set(partType, renderer)
}

/**
 * Register a renderer for a specific custom tool name. Matched only when the
 * part's `detail.kind === 'other'` and `detail.toolName === name`.
 */
export function registerCustomToolRenderer(name: string, renderer: ToolRenderer): void {
  byOtherName.set(name, renderer)
}

export function resolveToolRenderer(part: ToolPart): ToolRenderer | null {
  if (part.type === 'tool-other' && part.detail?.kind === 'other') {
    const custom = byOtherName.get(part.detail.toolName)
    if (custom) return custom
  }
  return byPartType.get(part.type) ?? null
}

/** Narrow a generic Part to a ToolPart via structural check. */
export function asToolPart(part: Part): ToolPart | null {
  if (typeof part.type !== 'string' || !part.type.startsWith('tool-')) return null
  return part as unknown as ToolPart
}

export function clearToolRegistry(): void {
  byPartType.clear()
  byOtherName.clear()
}
