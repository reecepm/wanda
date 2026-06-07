// -----------------------------------------------------------------------------
// Plan items.
//
// Used for both `plan.updated` events and the `plan` PermissionRequest
// variant. Dependency graph is intentionally flat with `dependsOn`; subplans
// (parent/child trees) are deferred (see 01 §11).
// -----------------------------------------------------------------------------

import { z } from 'zod'
import { PlanItemIdSchema } from './ids.ts'

export const PlanItemStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'skipped', 'failed'])
export type PlanItemStatus = z.infer<typeof PlanItemStatusSchema>

export const PlanItemSchema = z.object({
  id: PlanItemIdSchema,
  title: z.string().min(1).max(500),
  description: z.string().max(4000).optional(),
  status: PlanItemStatusSchema,
  /** Runtime enforces acyclicity; schema does not. */
  dependsOn: z.array(PlanItemIdSchema).default([]),
  /** Opaque provider-specific correlation. */
  providerRef: z.string().max(256).optional(),
})
export type PlanItem = z.infer<typeof PlanItemSchema>
