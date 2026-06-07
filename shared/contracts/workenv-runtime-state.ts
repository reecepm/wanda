// -----------------------------------------------------------------------------
// Per-adapter runtime state.
//
// Adapters cannot own DB schema. Anything
// adapter-specific that needs to round-trip through SQLite goes in the
// opaque `runtime_state` JSON column on `workenvs`. This file is the
// type-level contract for that JSON: a discriminated union keyed by
// `runtime`.
//
// New adapters extend this union, not the workenvs table.
// -----------------------------------------------------------------------------

import { z } from 'zod'

export const orbstackRuntimeStateSchema = z.object({
  runtime: z.literal('orbstack'),
  vmName: z.string().min(1),
  arch: z.enum(['arm64', 'amd64']),
  /** Present when this VM was cloned from a Wanda prebuild template machine. */
  prebuildHash: z.string().min(1).optional(),
})
export type OrbstackRuntimeState = z.infer<typeof orbstackRuntimeStateSchema>

// Single-runtime today; kept as a discriminated union so future adapters
// (lima, krunkit, …) can extend without touching the workenvs table.
export const workenvRuntimeStateSchema = z.discriminatedUnion('runtime', [orbstackRuntimeStateSchema])
export type WorkenvRuntimeState = z.infer<typeof workenvRuntimeStateSchema>
