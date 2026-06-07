// -----------------------------------------------------------------------------
// Shared adapter utilities.
//
// Runtime adapters shell out to a binary for lifecycle operations. This
// module provides:
//   1. A CliRunner abstraction (spawn via execFile + Effect wrapper) that
//      tests can stub without monkey-patching node:child_process.
//   2. AdapterError — a tagged error class so callers can branch on kind.
//
// Keep this file side-effect free: no eager spawns, no singletons. Each
// adapter instantiates with its own runner.
// -----------------------------------------------------------------------------

import { execFile } from 'node:child_process'
import { Effect } from 'effect'

export type AdapterErrorKind =
  | 'cli-failed'
  | 'invalid-config'
  | 'port-collision'
  | 'not-installed'
  | 'not-found'
  | 'timeout'
  | 'unsupported'

export class AdapterError extends Error {
  readonly kind: AdapterErrorKind
  readonly cause?: unknown
  readonly details?: Readonly<Record<string, unknown>>

  constructor(
    message: string,
    kind: AdapterErrorKind,
    opts?: { cause?: unknown; details?: Readonly<Record<string, unknown>> },
  ) {
    super(message)
    this.name = 'AdapterError'
    this.kind = kind
    this.cause = opts?.cause
    this.details = opts?.details
  }
}

export interface CliOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly input?: string
  readonly timeoutMs?: number
}

export interface CliOutcome {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type CliRunner = (
  cmd: string,
  args: readonly string[],
  opts?: CliOptions,
) => Effect.Effect<CliOutcome, AdapterError>

/**
 * Spawn `cmd` with `args` via execFile and collect stdout/stderr. Resolves
 * even on non-zero exit — the caller decides whether a non-zero exit is
 * an error (e.g. `orb status` uses exit code as signal).
 *
 * Mapped AdapterError kinds:
 *   - `not-installed`: ENOENT (binary missing on PATH)
 *   - `timeout`: spawn exceeded `timeoutMs`
 *   - `cli-failed`: any other spawn-layer failure
 */
export const defaultCliRunner: CliRunner = (cmd, args, opts = {}) =>
  Effect.async<CliOutcome, AdapterError>((resume) => {
    const child = execFile(
      cmd,
      [...args],
      {
        cwd: opts.cwd,
        env: opts.env,
        timeout: opts.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (!err) {
          resume(Effect.succeed({ code: 0, stdout: String(stdout), stderr: String(stderr) }))
          return
        }
        // Node's execFile returns err.code for non-zero exit; err.killed
        // for signal/timeout; err.code === 'ENOENT' when the binary is
        // missing.
        const errCode = (err as NodeJS.ErrnoException).code
        if (errCode === 'ENOENT') {
          resume(Effect.fail(new AdapterError(`${cmd} not found on PATH`, 'not-installed', { cause: err })))
          return
        }
        if ((err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          resume(
            Effect.fail(
              new AdapterError(`${cmd} timed out after ${opts.timeoutMs}ms`, 'timeout', {
                cause: err,
              }),
            ),
          )
          return
        }
        // Non-zero exit: surface as a successful outcome so the caller can
        // decide whether the code is an error. `err.code` is the exit code
        // here (number), not a Node error string.
        const numericCode = typeof errCode === 'number' ? errCode : 1
        resume(
          Effect.succeed({
            code: numericCode,
            stdout: String(stdout),
            stderr: String(stderr),
          }),
        )
      },
    )

    if (opts.input !== undefined && child.stdin) {
      child.stdin.end(opts.input)
    }

    return Effect.sync(() => {
      if (!child.killed) child.kill('SIGTERM')
    })
  })

/** Utility: strip trailing newlines that CLIs emit. */
export function trim(s: string): string {
  return s.replace(/\s+$/, '')
}

/** Extract the JSON-parsed payload from a CLI stdout, tolerating leading noise. */
export function parseJsonOutput<T>(stdout: string, context: string): T {
  try {
    return JSON.parse(stdout) as T
  } catch (cause) {
    throw new AdapterError(`failed to parse ${context} JSON`, 'cli-failed', {
      cause,
      details: { stdout: stdout.slice(0, 500) },
    })
  }
}
