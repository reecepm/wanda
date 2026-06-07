// -----------------------------------------------------------------------------
// Workenv shared contracts.
//
// Zod schemas + TS types that cross the client/server boundary for the
// per-worktree VM/container "workenv" system. The server-side controllers
// import from here; the renderer imports from here. Any new field that
// needs to be configured by users or surfaced in the UI lives in this file.
//
// The runtime-specific state shape (per-adapter) lives in
// `./workenv-runtime-state` so adapters can extend it without touching this
// user-facing schema.
// -----------------------------------------------------------------------------

import { z } from 'zod'

// --- Runtime / state enums ------------------------------------------------

export const workenvRuntimeSchema = z.enum(['orbstack'])
export type WorkenvRuntime = z.infer<typeof workenvRuntimeSchema>

export const workenvStateSchema = z.enum([
  'creating',
  'stopped',
  'starting',
  'running',
  'stopping',
  'destroyed',
  'error',
  'stranded',
])
export type WorkenvState = z.infer<typeof workenvStateSchema>

// --- Capabilities ---------------------------------------------------------

export const workenvCapabilitySchema = z.enum(['compose', 'snapshot', 'namedVolumes', 'gpu', 'ssh'])
export type WorkenvCapability = z.infer<typeof workenvCapabilitySchema>

// --- Config sub-schemas ---------------------------------------------------

export const workenvBaseSchema = z.object({
  image: z.string().optional(),
  arch: z.enum(['arm64', 'amd64']).optional(),
})
export type WorkenvBase = z.infer<typeof workenvBaseSchema>

export const workenvResourcesSchema = z.object({
  cpus: z.number().positive().optional(),
  memoryMB: z.number().int().positive().optional(),
  diskGB: z.number().int().positive().optional(),
})
export type WorkenvResources = z.infer<typeof workenvResourcesSchema>

export const workenvMountSchema = z.object({
  host: z.string().optional(),
  guest: z.string().min(1),
  mode: z.enum(['rw', 'ro']),
  kind: z.enum(['bind', 'cache']),
  cacheKey: z.string().optional(),
})
export type WorkenvMount = z.infer<typeof workenvMountSchema>

export const workenvPortSchema = z.object({
  name: z.string().min(1),
  guest: z.number().int().positive(),
  host: z.union([z.number().int().positive(), z.literal('auto')]),
  protocol: z.enum(['tcp', 'udp']),
})
export type WorkenvPort = z.infer<typeof workenvPortSchema>

/** Resolved port: host is always a concrete number after allocation. */
export const workenvResolvedPortSchema = z.object({
  name: z.string().min(1),
  guest: z.number().int().positive(),
  host: z.number().int().positive(),
  protocol: z.enum(['tcp', 'udp']),
})
export type WorkenvResolvedPort = z.infer<typeof workenvResolvedPortSchema>

export const workenvEnvValueSchema = z.union([
  z.string(),
  z.object({ fromSecret: z.string().min(1) }),
  z.object({ fromHost: z.string().min(1) }),
])
export type WorkenvEnvValue = z.infer<typeof workenvEnvValueSchema>

export const workenvHealthcheckSchema = z.object({
  cmd: z.string().min(1),
  intervalSec: z.number().int().positive(),
  startPeriodSec: z.number().int().nonnegative(),
})
export type WorkenvHealthcheck = z.infer<typeof workenvHealthcheckSchema>

// --- Bootstrap / post-start steps (discriminated union) --------------------

const workenvRunnableStepBaseSchema = z.object({
  /** Optional display label for progress UI. */
  label: z.string().min(1).optional(),
  /** Guest working directory. Supports `${ENV_VAR}` interpolation at runtime. */
  cwd: z.string().min(1).optional(),
  /** Guest user to run as. Defaults to root. */
  asUser: z.string().min(1).optional(),
  idempotencyKey: z.string().optional(),
  /**
   * Skip this runtime step when the workenv VM was cloned from a matching
   * prebuilt template. Use for expensive fallback setup that prebuild already
   * performed, such as dependency priming or database seeding.
   */
  skipWhenPrebuilt: z.boolean().optional(),
})

export const workenvBootstrapStepSchema = z.discriminatedUnion('kind', [
  workenvRunnableStepBaseSchema.extend({
    kind: z.literal('shell'),
    run: z.string().min(1),
  }),
  workenvRunnableStepBaseSchema.extend({
    kind: z.literal('script'),
    path: z.string().min(1),
  }),
  workenvRunnableStepBaseSchema.extend({
    kind: z.literal('hostScript'),
    /** Host-local script path. Wanda streams this into the guest shell. */
    path: z.string().min(1),
  }),
  z.object({
    kind: z.literal('recipe'),
    ref: z.string().min(1),
    with: z.record(z.string(), z.unknown()).optional(),
  }),
])
export type WorkenvBootstrapStep = z.infer<typeof workenvBootstrapStepSchema>

// --- Composable template layers ------------------------------------------

/**
 * Typed building blocks the user picks/orders to construct a workenv. Layers
 * compile down to (mounts, ports, env, bootstrap) at workenv-create / update
 * time so the rest of the system continues to consume the flat shape.
 *
 * Two projects with different stacks (bun vs pnpm, go vs rust) just pick
 * different `tool:` layers — no schema branching, no shell pasting.
 */

export const workenvLayerShellStepSchema = z.object({
  run: z.string().min(1),
  /** When false (default), the step runs as root. */
  asUser: z.string().optional(),
  /**
   * Stable key. If a previously-run bootstrap event with the same key
   * recorded `completed`, the step is skipped on subsequent runs.
   */
  idempotencyKey: z.string().optional(),
})
export type WorkenvLayerShellStep = z.infer<typeof workenvLayerShellStepSchema>

const baseLayerSchema = z.object({
  kind: z.literal('base'),
  /** Layer id, e.g. `base:ubuntu-24`. Stable across the catalog. */
  id: z.string().min(1),
  image: z.string().min(1),
  arch: z.enum(['arm64', 'amd64']).optional(),
  /**
   * Steps run immediately after the base image is up. Use for universal
   * essentials (curl, git, ca-certs, build deps) so users don't have to
   * add them as separate layers. Runs as root by default.
   */
  install: z.array(workenvLayerShellStepSchema).optional(),
})

const pkgLayerSchema = z.object({
  kind: z.literal('pkg'),
  id: z.string().min(1),
  manager: z.enum(['apt', 'apk']),
  packages: z.array(z.string().min(1)).min(1),
})

const toolLayerSchema = z.object({
  kind: z.literal('tool'),
  id: z.string().min(1),
  /** Display name (`Node 22`, `Bun`, `Taskfile CLI`). */
  name: z.string().min(1),
  install: z.array(workenvLayerShellStepSchema).min(1),
  /**
   * Runtime checks/repairs run after VM start. These are useful with
   * prebuilt machines where install steps ran at image-build time, but the
   * pod still wants a cheap assertion that the tool is usable.
   */
  verify: z.array(workenvLayerShellStepSchema).optional(),
  /**
   * Free-form params a tool layer can declare (e.g. `version: '22'` for the
   * Node layer). The compiler interpolates `${param.NAME}` against install
   * and verify steps.
   */
  params: z.record(z.string(), z.string()).optional(),
})

const serviceLayerSchema = z.object({
  kind: z.literal('service'),
  id: z.string().min(1),
  name: z.string().min(1),
  image: z.string().min(1),
  ports: z.array(workenvPortSchema).optional(),
  env: z.record(z.string().min(1), z.string()).optional(),
})

const authLayerSchema = z.object({
  kind: z.literal('auth'),
  id: z.string().min(1),
  name: z.string().min(1),
  /** Bind mounts from host into VM, e.g. `~/.gitconfig` → `/root/.gitconfig`. */
  mounts: z.array(workenvMountSchema).optional(),
  env: z.record(z.string().min(1), workenvEnvValueSchema).optional(),
  /** Host-side shell snippets whose stdout is exported as that env var. */
  resolveEnv: z.record(z.string().min(1), z.string().min(1)).optional(),
  /** Host-side shell snippets whose stdout is written to the named guest file. */
  resolveFiles: z.record(z.string().min(1), z.string().min(1)).optional(),
})

const shellLayerSchema = z.object({
  kind: z.literal('shell'),
  id: z.string().min(1),
  name: z.string().optional(),
  steps: z.array(workenvLayerShellStepSchema).min(1),
})

export const workenvLayerSchema = z.discriminatedUnion('kind', [
  baseLayerSchema,
  pkgLayerSchema,
  toolLayerSchema,
  serviceLayerSchema,
  authLayerSchema,
  shellLayerSchema,
])
export type WorkenvLayer = z.infer<typeof workenvLayerSchema>
export type WorkenvLayerKind = WorkenvLayer['kind']

// --- Top-level config -----------------------------------------------------

/**
 * User-facing workenv configuration. Persisted as JSON in `workenvs.config`.
 * The minimum viable input is `{ runtime, worktreePath }`; everything else
 * falls back to adapter defaults.
 */
export const workenvConfigSchema = z.object({
  runtime: workenvRuntimeSchema,
  worktreePath: z.string().min(1),
  extends: z.array(z.string().min(1)).optional(),
  base: workenvBaseSchema.optional(),
  resources: workenvResourcesSchema.optional(),
  mounts: z.array(workenvMountSchema).optional(),
  ports: z.array(workenvPortSchema).optional(),
  env: z.record(z.string().min(1), workenvEnvValueSchema).optional(),
  /**
   * Template-time hooks baked into reusable prebuild machines. These run
   * after prebuildable layers and before the template VM is stopped/cloned.
   * Use for stack-specific setup that should be paid once per template hash,
   * not once per pod. Project tools remain user-authored here; Wanda does not
   * special-case frameworks or CLIs.
   */
  prebuild: z.array(workenvBootstrapStepSchema).optional(),
  bootstrap: z.array(workenvBootstrapStepSchema).optional(),
  /**
   * Runtime hooks that run after layers, runtime checks, mounts, and
   * bootstrap steps have completed, but before the workenv is marked running.
   * Use for project-owned setup scripts that need the mounted worktree.
   */
  postStart: z.array(workenvBootstrapStepSchema).optional(),
  /**
   * Composable template layers (base + tool + auth + …). Compiled into
   * (base, mounts, ports, env, bootstrap) at create/update time. User-set
   * fields above win on conflicts so the escape hatch always works.
   */
  layers: z.array(workenvLayerSchema).optional(),
  workdir: z.string().optional(),
  healthcheck: workenvHealthcheckSchema.optional(),
  requires: z.array(workenvCapabilitySchema).optional(),
})
export type WorkenvConfig = z.infer<typeof workenvConfigSchema>

// --- Event types (the union of `workenv_events.type` values) --------------

export const workenvEventTypeSchema = z.enum([
  'created',
  'destroyed',
  'state.changed',
  'bootstrap.started',
  'bootstrap.step.started',
  'bootstrap.step.completed',
  'bootstrap.step.failed',
  'bootstrap.completed',
  'health.ok',
  'health.failed',
  'ports.changed',
  'error',
])
export type WorkenvEventType = z.infer<typeof workenvEventTypeSchema>

/**
 * Status carried by `workenv.bootstrap.progress` events. Distinct from the
 * persisted `workenv_events.type` values which split into started/completed/
 * failed rows for replay; the progress event stream collapses them.
 */
export const workenvBootstrapStatusSchema = z.enum(['started', 'succeeded', 'failed'])
export type WorkenvBootstrapStatus = z.infer<typeof workenvBootstrapStatusSchema>

// --- Adapter availability probe --------------------------------------------

export const workenvProbeResultSchema = z.object({
  runtime: workenvRuntimeSchema,
  available: z.boolean(),
  version: z.string().optional(),
  error: z.string().optional(),
})
export type WorkenvProbeResult = z.infer<typeof workenvProbeResultSchema>
