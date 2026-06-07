// -----------------------------------------------------------------------------
// FakeRuntimeAdapter — deterministic, programmable adapter used by every
// test that exercises the workenv pipeline without a real VM. Also used at
// runtime when `WANDA_FAKE_RUNTIME=1` is set so Playwright e2e specs can
// drive the full server without a real VM runtime.
//
// Design rules:
// - Mirrors PtyService's "tracker + factory" pattern (see test-layer.ts).
// - Records every call so tests can assert on them.
// - All behaviour (probe, capabilities, exec output, error injection) is
//   public mutable state — callers tweak it in place between assertions.
// - One implementation, two consumers (tests + e2e). Don't fork it.
// -----------------------------------------------------------------------------

import { Effect } from 'effect'
import { v4 as uuid } from 'uuid'
import type { WorkenvResolvedPort, WorkenvRuntime } from '../../shared/contracts/workenv'
import type { WorkenvRuntimeState } from '../../shared/contracts/workenv-runtime-state'
import type {
  CreateSpec,
  ExecRequest,
  ExecSession,
  ProbeResult,
  RuntimeAdapter,
  RuntimeCapabilities,
  WorkenvHandle,
  WorkenvStatus,
} from '../domains/workenv/types/adapter'

const DEFAULT_CAPABILITIES: RuntimeCapabilities = {
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

type FailableMethod = 'create' | 'clone' | 'start' | 'stop' | 'destroy' | 'exec'

export interface FakeExecScript {
  readonly data?: readonly string[]
  readonly exitCode?: number
}

export interface FakeExecSessionLog {
  readonly id: string
  readonly handle: WorkenvHandle
  readonly req: ExecRequest
  readonly writes: string[]
  readonly resizes: { cols: number; rows: number }[]
  readonly signals: ('SIGINT' | 'SIGTERM' | 'SIGKILL')[]
  destroyed: boolean
  readonly chunks: string[]
  exitCode: number
}

export interface FakeRuntimeAdapterOptions {
  readonly runtime?: WorkenvRuntime
  readonly version?: string
}

export class FakeRuntimeAdapter implements RuntimeAdapter {
  readonly id: WorkenvRuntime
  readonly version: string

  /** Mutable per-method call log. Reset by re-instantiating the adapter. */
  readonly calls = {
    create: [] as CreateSpec[],
    clone: [] as { source: WorkenvHandle; spec: CreateSpec }[],
    start: [] as WorkenvHandle[],
    stop: [] as WorkenvHandle[],
    destroy: [] as WorkenvHandle[],
    exec: [] as { handle: WorkenvHandle; req: ExecRequest }[],
    probe: 0,
    capabilities: 0,
    list: 0,
    status: [] as WorkenvHandle[],
  }

  /** Replace to alter probe behaviour. */
  probeResult: ProbeResult = { available: true, version: 'fake-1.0.0' }

  /** Replace to alter capability surface. */
  capabilitiesValue: RuntimeCapabilities = { ...DEFAULT_CAPABILITIES }

  /** Set to inject a one-shot failure on the named method. Cleared on use. */
  failNext: { method: FailableMethod; error: Error } | null = null

  /** Default scripted exec output applied to every new session. */
  execScript: FakeExecScript = { data: [], exitCode: 0 }

  /** Programmable resolved-ports map (per adapterHandle) returned by status(). */
  resolvedPortsByHandle = new Map<string, WorkenvResolvedPort[]>()

  /** Inspectable per-session record (in creation order). */
  readonly execSessions: FakeExecSessionLog[] = []

  private handles = new Map<string, WorkenvHandle>()
  private running = new Set<string>()

  constructor(opts: FakeRuntimeAdapterOptions = {}) {
    this.id = opts.runtime ?? 'orbstack'
    this.version = opts.version ?? 'fake-1.0.0'
  }

  capabilities(): RuntimeCapabilities {
    this.calls.capabilities += 1
    return this.capabilitiesValue
  }

  probe(): Effect.Effect<ProbeResult> {
    return Effect.sync(() => {
      this.calls.probe += 1
      return this.probeResult
    })
  }

  create(spec: CreateSpec): Effect.Effect<WorkenvHandle, Error> {
    return Effect.suspend(() => {
      this.calls.create.push(spec)
      const failure = this.takeFailure('create')
      if (failure) return Effect.fail(failure)
      const handle = this.makeHandle(spec.slug)
      this.handles.set(handle.adapterHandle, handle)
      return Effect.succeed(handle)
    })
  }

  clone(source: WorkenvHandle, spec: CreateSpec): Effect.Effect<WorkenvHandle, Error> {
    return Effect.suspend(() => {
      this.calls.clone.push({ source, spec })
      if (!this.handles.has(source.adapterHandle)) {
        return Effect.fail(new Error(`clone: unknown source ${source.adapterHandle}`))
      }
      const failure = this.takeFailure('clone')
      if (failure) return Effect.fail(failure)
      const handle = this.makeHandle(spec.slug)
      this.handles.set(handle.adapterHandle, handle)
      return Effect.succeed(handle)
    })
  }

  start(handle: WorkenvHandle): Effect.Effect<void, Error> {
    return Effect.suspend(() => {
      this.calls.start.push(handle)
      if (!this.handles.has(handle.adapterHandle)) {
        return Effect.fail(new Error(`start: unknown handle ${handle.adapterHandle}`))
      }
      const failure = this.takeFailure('start')
      if (failure) return Effect.fail(failure)
      this.running.add(handle.adapterHandle)
      return Effect.void
    })
  }

  stop(handle: WorkenvHandle): Effect.Effect<void, Error> {
    return Effect.suspend(() => {
      this.calls.stop.push(handle)
      if (!this.handles.has(handle.adapterHandle)) {
        return Effect.fail(new Error(`stop: unknown handle ${handle.adapterHandle}`))
      }
      const failure = this.takeFailure('stop')
      if (failure) return Effect.fail(failure)
      this.running.delete(handle.adapterHandle)
      return Effect.void
    })
  }

  destroy(handle: WorkenvHandle): Effect.Effect<void, Error> {
    return Effect.suspend(() => {
      this.calls.destroy.push(handle)
      if (!this.handles.has(handle.adapterHandle)) {
        return Effect.fail(new Error(`destroy: unknown handle ${handle.adapterHandle}`))
      }
      const failure = this.takeFailure('destroy')
      if (failure) return Effect.fail(failure)
      this.running.delete(handle.adapterHandle)
      this.handles.delete(handle.adapterHandle)
      return Effect.void
    })
  }

  status(handle: WorkenvHandle): Effect.Effect<WorkenvStatus> {
    return Effect.sync(() => {
      this.calls.status.push(handle)
      return {
        running: this.running.has(handle.adapterHandle),
        resolvedPorts: this.resolvedPortsByHandle.get(handle.adapterHandle),
      }
    })
  }

  list(): Effect.Effect<readonly WorkenvHandle[]> {
    return Effect.sync(() => {
      this.calls.list += 1
      return Array.from(this.handles.values())
    })
  }

  exec(handle: WorkenvHandle, req: ExecRequest): ExecSession {
    this.calls.exec.push({ handle, req })

    const id = uuid()
    const subscribers = new Set<(data: string) => void>()
    const log: FakeExecSessionLog = {
      id,
      handle,
      req,
      writes: [],
      resizes: [],
      signals: [],
      destroyed: false,
      chunks: [],
      exitCode: this.execScript.exitCode ?? 0,
    }
    this.execSessions.push(log)

    let resolveExit!: (code: number) => void
    const exit = new Promise<number>((res) => {
      resolveExit = res
    })

    // Drain scripted output after the current event-loop tick. Using
    // setImmediate (rather than queueMicrotask) pushes the drain past the
    // I/O phase so e2e consumers on the far side of a WebSocket have time
    // to subscribe to terminal:data / terminal:exit before the adapter
    // fires them. Unit tests that `await session.exit` are unaffected.
    setImmediate(() => {
      try {
        this.consumeFailure('exec')
      } catch (err) {
        // Resolve exit with a non-zero "spawn failed" code and propagate
        // via a thrown error string on the data stream.
        log.exitCode = 127
        for (const cb of subscribers) cb(err instanceof Error ? err.message : String(err))
        resolveExit(log.exitCode)
        return
      }

      for (const chunk of this.execScript.data ?? []) {
        log.chunks.push(chunk)
        for (const cb of subscribers) cb(chunk)
      }
      resolveExit(log.exitCode)
    })

    const session: ExecSession = {
      id,
      write: (data) => log.writes.push(data),
      resize: (cols, rows) => log.resizes.push({ cols, rows }),
      signal: (sig) => log.signals.push(sig),
      onData: (cb) => {
        subscribers.add(cb)
        return () => subscribers.delete(cb)
      },
      exit,
      destroy: () => {
        log.destroyed = true
      },
    }
    return session
  }

  // ---- Internals -----------------------------------------------------------

  private makeHandle(slug: string): WorkenvHandle {
    const adapterHandle = `wanda-${slug}-${uuid().slice(0, 6)}`
    const state: WorkenvRuntimeState = { runtime: 'orbstack', vmName: adapterHandle, arch: 'arm64' }
    return { runtime: this.id, adapterHandle, state }
  }

  /**
   * Pop a pending failNext for `method` and return it (without throwing).
   * Effect-friendly variant of `consumeFailure`.
   */
  private takeFailure(method: FailableMethod): Error | null {
    if (this.failNext && this.failNext.method === method) {
      const err = this.failNext.error
      this.failNext = null
      return err
    }
    return null
  }

  private consumeFailure(method: FailableMethod): void {
    if (this.failNext && this.failNext.method === method) {
      const err = this.failNext.error
      this.failNext = null
      throw err
    }
  }
}
