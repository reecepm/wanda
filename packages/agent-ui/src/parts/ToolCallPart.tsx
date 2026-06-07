// -----------------------------------------------------------------------------
// ToolCallPart — resolves the registered renderer for a tool part. When no
// renderer is registered we still render the canonical ToolRow shell so the
// layout stays coherent.
// -----------------------------------------------------------------------------

import { asToolPart, resolveToolRenderer, type ToolPart } from '../tools/registry'
import { ToolRow, type ToolRowStatus } from '../ui/ToolRow'

export function ToolCallPart({ part }: { part: ToolPart }) {
  const renderer = resolveToolRenderer(part)
  if (!renderer) {
    return (
      <ToolRow
        title={part.title ?? part.type}
        subtitle="no renderer registered"
        status={part.status as ToolRowStatus}
      />
    )
  }
  return <>{renderer({ part })}</>
}

export { asToolPart }
