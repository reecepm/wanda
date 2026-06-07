// -----------------------------------------------------------------------------
// OrbstackAdapter — wraps the `orbctl` CLI.
//
// Scope:
//   - VM name: `wanda-<slug>`, created via `orbctl create -a <arch> <distro> <name>`
//   - Worktree mount: auto-mount at `/mnt/mac/...` for $HOME paths only;
//     paths outside $HOME are rejected at validation.
//   - Resources (cpus/memoryMB/diskGB) are rejected at validation because
//     OrbStack silently ignores them.
//   - Port collision behaviour is "silent-drop"; detection lives in the
//     ports service (not here).
//   - Exec uses `orbctl run -m <vm> bash -lc 'cd <workdir> && exec <cmd>'`,
//     spawned via PtyService so scrollback/flow control reuses the existing
//     terminal pipeline.
//
// The adapter is constructed with a CliRunner + (optional) PtyServiceShape
// so tests can swap the I/O layer.
// -----------------------------------------------------------------------------

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { Effect } from 'effect'
import type { WorkenvConfig } from '../../../../shared/contracts/workenv'
import type { OrbstackRuntimeState } from '../../../../shared/contracts/workenv-runtime-state'
import type { PtyServiceShape } from '../../../services/pty.service'
import type {
  CreateSpec,
  ExecRequest,
  ExecSession,
  ProbeResult,
  RuntimeAdapter,
  RuntimeCapabilities,
  WorkenvHandle,
  WorkenvStatus,
} from '../types/adapter'
import { AdapterError, type CliRunner, defaultCliRunner, parseJsonOutput } from './shared'

// Packaged Electron apps on macOS launch with a stripped PATH
// (`/usr/bin:/bin:/usr/sbin:/sbin`), so a bare `orbctl` lookup fails even
// when OrbStack is installed. Resolve to an absolute path by probing the
// canonical install location and the symlinks OrbStack drops on PATH.
function resolveOrbBin(): string {
  const candidates = [
    '/Applications/OrbStack.app/Contents/MacOS/bin/orbctl',
    '/usr/local/bin/orbctl',
    '/opt/homebrew/bin/orbctl',
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return 'orbctl'
}

const ORB_BIN = resolveOrbBin()
const DEFAULT_DISTRO = 'ubuntu'
const DEFAULT_ARCH = 'arm64'

const CAPABILITIES: RuntimeCapabilities = {
  networking: true,
  portPublishing: true,
  supportsCompose: true,
  supportsSnapshot: false,
  supportsNamedVolumes: true,
  supportsGpu: false,
  fsSharingModel: 'auto-host-home',
  resourcesEnforced: false,
  portCollisionBehaviour: 'silent-drop',
  overheadMBApprox: 256,
}

interface OrbstackAdapterOptions {
  readonly runner?: CliRunner
  readonly pty?: PtyServiceShape
  /** Override for testing. Defaults to `os.homedir()`. */
  readonly homeDir?: string
}

interface OrbctlRecord {
  readonly id?: string
  readonly name: string
  readonly image?: { readonly arch?: 'arm64' | 'amd64'; readonly distro?: string }
  readonly state?: string
}

interface OrbctlInfoPayload {
  readonly record: OrbctlRecord
  readonly disk_size?: number
}

export class OrbstackAdapter implements RuntimeAdapter {
  readonly id = 'orbstack' as const
  version = 'unknown'

  private readonly runner: CliRunner
  private readonly pty?: PtyServiceShape
  private readonly homeDir: string

  constructor(opts: OrbstackAdapterOptions = {}) {
    this.runner = opts.runner ?? defaultCliRunner
    this.pty = opts.pty
    this.homeDir = opts.homeDir ?? homedir()
  }

  capabilities(): RuntimeCapabilities {
    return CAPABILITIES
  }

  probe(): Effect.Effect<ProbeResult> {
    return Effect.gen(this, function* () {
      const versionOutcome = yield* Effect.either(this.runner(ORB_BIN, ['version']))
      if (versionOutcome._tag === 'Left') {
        return { available: false, error: versionOutcome.left.message }
      }
      const v = versionOutcome.right
      if (v.code !== 0) {
        return { available: false, error: v.stderr.trim() || `orbctl version exit ${v.code}` }
      }
      const version = parseVersion(v.stdout)
      this.version = version ?? this.version

      const statusOutcome = yield* Effect.either(this.runner(ORB_BIN, ['status']))
      if (statusOutcome._tag === 'Left') {
        return { available: false, error: statusOutcome.left.message }
      }
      const s = statusOutcome.right
      if (s.code !== 0 || !/Running/i.test(s.stdout)) {
        return {
          available: false,
          version,
          error: (s.stdout || s.stderr).trim() || 'orbstack not running',
        }
      }
      return { available: true, version }
    })
  }

  create(spec: CreateSpec): Effect.Effect<WorkenvHandle, Error> {
    return Effect.gen(this, function* () {
      yield* validateCreateSpec(spec, this.homeDir)
      const vmName = handleName(spec.slug)
      const arch = spec.config.base?.arch ?? DEFAULT_ARCH
      const distro = spec.config.base?.image ?? DEFAULT_DISTRO

      const outcome = yield* this.runner(ORB_BIN, ['create', '-a', arch, distro, vmName])
      if (outcome.code !== 0) {
        return yield* Effect.fail(
          new AdapterError(
            (outcome.stderr || outcome.stdout).trim() || `orbctl create exit ${outcome.code}`,
            'cli-failed',
          ),
        )
      }

      const state: OrbstackRuntimeState = { runtime: 'orbstack', vmName, arch }
      return { runtime: 'orbstack', adapterHandle: vmName, state }
    })
  }

  start(handle: WorkenvHandle): Effect.Effect<void, Error> {
    return this.runSimple('start', ['start', handle.adapterHandle])
  }

  stop(handle: WorkenvHandle): Effect.Effect<void, Error> {
    return this.runSimple('stop', ['stop', handle.adapterHandle])
  }

  destroy(handle: WorkenvHandle): Effect.Effect<void, Error> {
    return Effect.gen(this, function* () {
      const outcome = yield* this.runner(ORB_BIN, ['delete', '-f', handle.adapterHandle])
      if (outcome.code === 0) return
      // Idempotent: "no such machine" isn't a failure.
      const combined = `${outcome.stderr}\n${outcome.stdout}`.toLowerCase()
      if (/no such machine|not found|unknown machine/.test(combined)) return
      return yield* Effect.fail(
        new AdapterError(
          (outcome.stderr || outcome.stdout).trim() || `orbctl delete exit ${outcome.code}`,
          'cli-failed',
        ),
      )
    })
  }

  clone(source: WorkenvHandle, spec: CreateSpec): Effect.Effect<WorkenvHandle, Error> {
    return Effect.gen(this, function* () {
      yield* validateCreateSpec(spec, this.homeDir)
      const vmName = handleName(spec.slug)
      const arch = spec.config.base?.arch ?? (source.state.runtime === 'orbstack' ? source.state.arch : DEFAULT_ARCH)

      const outcome = yield* this.runner(ORB_BIN, ['clone', source.adapterHandle, vmName])
      if (outcome.code !== 0) {
        return yield* Effect.fail(
          new AdapterError(
            (outcome.stderr || outcome.stdout).trim() || `orbctl clone exit ${outcome.code}`,
            'cli-failed',
          ),
        )
      }

      const state: OrbstackRuntimeState = { runtime: 'orbstack', vmName, arch }
      return { runtime: 'orbstack', adapterHandle: vmName, state }
    })
  }

  status(handle: WorkenvHandle): Effect.Effect<WorkenvStatus, Error> {
    return Effect.gen(this, function* () {
      const outcome = yield* this.runner(ORB_BIN, ['info', handle.adapterHandle, '-f', 'json'])
      if (outcome.code !== 0) {
        const combined = `${outcome.stderr}\n${outcome.stdout}`.toLowerCase()
        if (/no such machine|not found|unknown machine/.test(combined)) {
          return yield* Effect.fail(new AdapterError(`orbstack vm '${handle.adapterHandle}' not found`, 'not-found'))
        }
        return yield* Effect.fail(
          new AdapterError(
            (outcome.stderr || outcome.stdout).trim() || `orbctl info exit ${outcome.code}`,
            'cli-failed',
          ),
        )
      }
      const payload = Effect.try({
        try: () => parseJsonOutput<OrbctlInfoPayload>(outcome.stdout, 'orbctl info'),
        catch: (err) =>
          err instanceof AdapterError ? err : new AdapterError(String(err), 'cli-failed', { cause: err }),
      })
      const info = yield* payload
      const running = (info.record.state ?? '').toLowerCase() === 'running'
      return { running }
    })
  }

  list(): Effect.Effect<readonly WorkenvHandle[], Error> {
    return Effect.gen(this, function* () {
      const outcome = yield* this.runner(ORB_BIN, ['list', '--format', 'json'])
      if (outcome.code !== 0) {
        return yield* Effect.fail(
          new AdapterError(
            (outcome.stderr || outcome.stdout).trim() || `orbctl list exit ${outcome.code}`,
            'cli-failed',
          ),
        )
      }
      const records = parseJsonOutput<readonly OrbctlRecord[]>(outcome.stdout, 'orbctl list')
      return records
        .filter((r) => r.name.startsWith('wanda-'))
        .map<WorkenvHandle>((r) => ({
          runtime: 'orbstack',
          adapterHandle: r.name,
          state: {
            runtime: 'orbstack',
            vmName: r.name,
            arch: r.image?.arch ?? DEFAULT_ARCH,
          },
        }))
    })
  }

  exec(handle: WorkenvHandle, req: ExecRequest): ExecSession {
    const { cmd, args = [], cwd, env, cols, rows, runAs } = req
    const inner = buildInnerShell({ cmd, args, cwd, env })
    // OrbStack maps the host user into the VM by default. Bootstrap and
    // any caller that needs to install packages must pass runAs='root'.
    const userFlags = runAs ? ['-u', runAs] : []
    const spawnArgs = ['run', ...userFlags, '-m', handle.adapterHandle, 'bash', '-lc', inner]

    // Non-PTY path for bootstrap-style commands: spawn orbctl directly so
    // stdout + stderr are captured deterministically. The PTY path has a
    // race between pty.create and the onAnyData listener registration that
    // can drop the first chunks of output — fatal when a command fails
    // immediately and the only signal the user gets is "exit 100".
    if (!req.pty) {
      return execNonPty(spawnArgs, env)
    }

    if (!this.pty) {
      throw new AdapterError(
        'OrbstackAdapter.exec requires a PtyService for PTY exec. Construct the adapter with `{ pty }`.',
        'unsupported',
      )
    }
    const pty = this.pty

    let resolveExit!: (code: number) => void
    const exit = new Promise<number>((res) => {
      resolveExit = res
    })

    const unsubs: Array<() => void> = []
    const subscribers = new Set<(data: string) => void>()
    let cleaned = false
    let ptyId = ''
    const cleanupSubscriptions = () => {
      if (cleaned) return
      cleaned = true
      for (const off of unsubs) off()
      unsubs.length = 0
      subscribers.clear()
    }

    ptyId = Effect.runSync(
      pty.create({
        cwd: process.cwd(),
        command: ORB_BIN,
        args: spawnArgs,
        cols,
        rows,
        env: env as Record<string, string> | undefined,
        restartPolicy: 'never',
        onExit: (_id, code) => {
          cleanupSubscriptions()
          resolveExit(code)
        },
      }),
    )

    unsubs.push(
      pty.onAnyData((id, data) => {
        if (id !== ptyId) return
        for (const cb of subscribers) cb(data)
        pty.ack(ptyId, data.length)
      }),
    )
    pty.subscribe(ptyId)
    unsubs.push(() => pty.unsubscribe(ptyId))

    const session: ExecSession = {
      id: ptyId,
      write: (data) => pty.write(ptyId, data),
      resize: (c, r) => pty.resize(ptyId, c, r),
      signal: (_sig) => {
        // PtyService doesn't expose signal; destroy is the closest.
        Effect.runSync(pty.destroy(ptyId))
      },
      onData: (cb) => {
        subscribers.add(cb)
        return () => subscribers.delete(cb)
      },
      exit,
      destroy: () => {
        cleanupSubscriptions()
        Effect.runSync(pty.destroy(ptyId))
      },
    }
    return session
  }

  // --- Internals -----------------------------------------------------------

  private runSimple(kind: 'start' | 'stop', args: readonly string[]): Effect.Effect<void, Error> {
    return Effect.gen(this, function* () {
      const outcome = yield* this.runner(ORB_BIN, args)
      if (outcome.code !== 0) {
        return yield* Effect.fail(
          new AdapterError(
            (outcome.stderr || outcome.stdout).trim() || `orbctl ${kind} exit ${outcome.code}`,
            'cli-failed',
          ),
        )
      }
    })
  }
}

// --- Helpers ---------------------------------------------------------------

function handleName(slug: string): string {
  return `wanda-${slug}`
}

function parseVersion(stdout: string): string | undefined {
  // `orbctl version` prints: "Version: X.Y.Z (build)\nCommit: ..."
  const m = stdout.match(/Version:\s*([^\s(]+)/)
  return m ? m[1] : undefined
}

function validateCreateSpec(spec: CreateSpec, homeDir: string): Effect.Effect<void, AdapterError> {
  return Effect.suspend(() => {
    const { config } = spec
    if (config.runtime !== 'orbstack') {
      return Effect.fail(
        new AdapterError(`OrbstackAdapter cannot create runtime='${config.runtime}'`, 'invalid-config'),
      )
    }
    const worktree = config.worktreePath
    if (!isUnderHome(worktree, homeDir)) {
      return Effect.fail(
        new AdapterError(
          `OrbStack only auto-mounts paths under $HOME. worktreePath='${worktree}' is outside '${homeDir}'.`,
          'invalid-config',
        ),
      )
    }
    if (hasResources(config)) {
      return Effect.fail(
        new AdapterError(
          'OrbStack ignores cpus/memoryMB/diskGB resource limits; remove config.resources for this runtime.',
          'invalid-config',
          { details: { resources: config.resources } },
        ),
      )
    }
    return Effect.void
  })
}

function hasResources(config: WorkenvConfig): boolean {
  const r = config.resources
  if (!r) return false
  return r.cpus !== undefined || r.memoryMB !== undefined || r.diskGB !== undefined
}

function isUnderHome(p: string, home: string): boolean {
  if (!p.startsWith('/')) return false
  const h = home.endsWith('/') ? home : `${home}/`
  return p === home || p.startsWith(h)
}

function buildInnerShell(opts: {
  cmd: string
  args: readonly string[]
  cwd?: string
  env?: Readonly<Record<string, string>>
}): string {
  const cdPart = opts.cwd ? `cd ${shellQuote(opts.cwd)} && ` : ''
  const envPart =
    opts.env && Object.keys(opts.env).length > 0
      ? `${['env', ...Object.entries(opts.env).map(([key, value]) => shellQuote(`${key}=${value}`))].join(' ')} `
      : ''
  const cmdPart = [opts.cmd, ...opts.args].map(shellQuote).join(' ')
  return `${cdPart}exec ${envPart}${cmdPart}`
}

/**
 * POSIX-safe shell quoter. We only quote when needed; identifiers and safe
 * paths pass through unchanged to keep the exec line readable in logs.
 */
function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./:+@=,%]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'"'"'`)}'`
}

/**
 * Non-PTY exec: spawn orbctl directly with piped stdout/stderr. The
 * command still runs inside the VM (orbctl is just the host-side bridge);
 * this only changes how the host captures the pipes — atomically from the
 * moment the child starts, with no listener-registration race.
 *
 * Used by bootstrap (req.pty=false) so layer install steps surface their
 * actual error output ("E: Unable to fetch …") instead of just an exit
 * code.
 */
function execNonPty(spawnArgs: readonly string[], env: Readonly<Record<string, string>> | undefined): ExecSession {
  const subscribers = new Set<(data: string) => void>()
  let bufferedOutput = ''
  let closed = false
  const child = spawn(ORB_BIN, [...spawnArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: env ? { ...process.env, ...env } : process.env,
  })

  function publish(buf: Buffer): void {
    if (closed) return
    const chunk = buf.toString('utf8')
    bufferedOutput += chunk
    for (const cb of subscribers) cb(chunk)
  }
  child.stdout?.on('data', publish)
  child.stderr?.on('data', publish)

  const exit = new Promise<number>((resolve) => {
    child.on('exit', (code, signal) => {
      closed = true
      // Match the PTY path's convention: signal kills surface as 128+sig.
      resolve(code ?? (signal ? 128 + (signalToNumber(signal) ?? 0) : 1))
    })
    child.on('error', (err) => {
      closed = true
      const chunk = `\n[orbctl spawn error] ${err.message}\n`
      bufferedOutput += chunk
      for (const cb of subscribers) cb(chunk)
      resolve(1)
    })
  })

  return {
    id: `nonpty-${child.pid ?? 'unknown'}`,
    write: () => {
      // Bootstrap steps don't write to stdin.
    },
    resize: () => {},
    signal: (sig) => {
      child.kill(sig)
    },
    onData: (cb) => {
      subscribers.add(cb)
      if (bufferedOutput.length > 0) cb(bufferedOutput)
      return () => subscribers.delete(cb)
    },
    exit,
    destroy: () => {
      closed = true
      subscribers.clear()
      if (!child.killed) child.kill('SIGTERM')
    },
  }
}

function signalToNumber(sig: NodeJS.Signals): number | null {
  // Common signals; missing entries are treated as 0 (just falls into 128+0).
  const map: Partial<Record<NodeJS.Signals, number>> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGKILL: 9,
    SIGTERM: 15,
  }
  return map[sig] ?? null
}
