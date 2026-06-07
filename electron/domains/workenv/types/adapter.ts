// -----------------------------------------------------------------------------
// Runtime adapter contract.
//
// One adapter wraps one VM/container runtime. The controller never branches
// on `adapter.id` — always on `capabilities()`.
// State-transition methods return Effect; `exec()` returns a raw
// ExecSession (PTY hot-path; thousands of writes/sec).
//
// Adapters MUST NOT extend the workenvs DB schema. Anything adapter-specific
// that needs to round-trip through SQLite goes in `runtime_state` JSON
// (typed via `WorkenvRuntimeState` discriminated union).
// -----------------------------------------------------------------------------

import type { Effect } from 'effect'
import type {
  WorkenvCapability,
  WorkenvConfig,
  WorkenvResolvedPort,
  WorkenvRuntime,
} from '../../../../shared/contracts/workenv'
import type { WorkenvRuntimeState } from '../../../../shared/contracts/workenv-runtime-state'

/**
 * Static capabilities — cheap, declared once per adapter. Core code branches
 * on these flags so behaviour stays adapter-agnostic.
 */
export interface RuntimeCapabilities {
  readonly networking: boolean
  readonly portPublishing: boolean
  readonly supportsCompose: boolean
  readonly supportsSnapshot: boolean
  readonly supportsNamedVolumes: boolean
  readonly supportsGpu: boolean
  /** Host filesystem sharing mode exposed by the runtime. */
  readonly fsSharingModel: 'auto-host-home' | 'explicit-mounts'
  /** True if cpu/memory/disk limits in `resources` are honoured. */
  readonly resourcesEnforced: boolean
  /** How the runtime reports host-port collisions. */
  readonly portCollisionBehaviour: 'silent-drop' | 'ssh-error'
  /** Approximate per-VM RAM overhead in MB. Surfaced in UI. */
  readonly overheadMBApprox: number
}

/** Live availability probe. Cached for ~5s by the registry. */
export interface ProbeResult {
  readonly available: boolean
  readonly version?: string
  readonly error?: string
}

/**
 * Adapter-owned identity for a workenv. `adapterHandle` is the durable
 * name the adapter uses (e.g. OrbStack VM name `wanda-<slug>`); it must be
 * unique within `runtime` and goes into the `workenvs.adapter_handle`
 * column once `create()` succeeds.
 */
export interface WorkenvHandle {
  readonly runtime: WorkenvRuntime
  readonly adapterHandle: string
  readonly state: WorkenvRuntimeState
}

/** Snapshot from the adapter — distinct from the controller-owned WorkenvState. */
export interface WorkenvStatus {
  readonly running: boolean
  readonly resolvedPorts?: readonly WorkenvResolvedPort[]
}

export interface ExecRequest {
  readonly cmd: string
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly cols?: number
  readonly rows?: number
  /** When true, allocates a PTY (interactive shell). */
  readonly pty: boolean
  /**
   * VM-side user the command runs as. Adapters that map the host user
   * into the VM by default (OrbStack) honour this to escalate to root
   * for bootstrap steps. Layer-level `asUser` is handled separately
   * (sudo wrap inside the command) — this is for the OUTER user.
   */
  readonly runAs?: string
}

/**
 * Raw exec session. Not Effect-wrapped because PTY I/O fires thousands of
 * times/sec; mirrors `PtyService`'s hot-path convention. The controller
 * wraps this for the route layer.
 */
export interface ExecSession {
  /** Underlying stream id (PTY id when backed by `PtyService`). */
  readonly id: string
  write(data: string): void
  resize(cols: number, rows: number): void
  signal(sig: 'SIGINT' | 'SIGTERM' | 'SIGKILL'): void
  /** Subscribe to byte stream. Returns unsubscribe. */
  onData(cb: (data: string) => void): () => void
  /** Resolves with the exit code once the session ends. */
  readonly exit: Promise<number>
  destroy(): void
}

export interface CreateSpec {
  readonly slug: string
  readonly config: WorkenvConfig
  readonly capabilitiesRequired?: readonly WorkenvCapability[]
}

export interface RuntimeAdapter {
  readonly id: WorkenvRuntime
  readonly version: string

  capabilities(): RuntimeCapabilities
  probe(): Effect.Effect<ProbeResult>

  create(spec: CreateSpec): Effect.Effect<WorkenvHandle, Error>
  start(handle: WorkenvHandle): Effect.Effect<void, Error>
  stop(handle: WorkenvHandle): Effect.Effect<void, Error>
  destroy(handle: WorkenvHandle): Effect.Effect<void, Error>
  status(handle: WorkenvHandle): Effect.Effect<WorkenvStatus, Error>

  exec(handle: WorkenvHandle, req: ExecRequest): ExecSession

  /**
   * List adapter-known VMs/profiles. Used by the reconciler to flag stranded
   * workenvs (rows recorded as `running` whose handle the adapter no longer
   * knows about).
   */
  list(): Effect.Effect<readonly WorkenvHandle[], Error>

  // -- Capability-gated. Presence implies support. ---------------------------
  snapshot?(handle: WorkenvHandle, name: string): Effect.Effect<void, Error>
  /**
   * Copy-on-write clone of an existing runtime artifact into a new workenv
   * handle. Used for prebuilt template machines; adapters that do not support
   * cheap clones omit this and the controller falls back to create+bootstrap.
   */
  clone?(source: WorkenvHandle, spec: CreateSpec): Effect.Effect<WorkenvHandle, Error>
  restore?(handle: WorkenvHandle, name: string): Effect.Effect<void, Error>
  publishPort?(handle: WorkenvHandle, port: WorkenvResolvedPort): Effect.Effect<void, Error>
  compose?(handle: WorkenvHandle, file: string): Effect.Effect<void, Error>
  mountVolume?(handle: WorkenvHandle, src: string, dest: string): Effect.Effect<void, Error>
  sshTarget?(handle: WorkenvHandle): Effect.Effect<{ host: string; user: string; port?: number }, Error>
}
