// -----------------------------------------------------------------------------
// WorkenvExec — minimal stream registry that bridges adapter ExecSessions
// to the existing terminal:data / terminal:exit broadcast channels, so the
// renderer can reuse one xterm.js path for both workenv and pod terminals.
// -----------------------------------------------------------------------------

import { Context, Effect, Layer } from 'effect'
import { workenvRuntimeStateSchema } from '../../../../shared/contracts/workenv-runtime-state'
import { Broadcaster } from '../../../infra/broadcaster'
import { DatabaseService } from '../../../infra/database'
import { log } from '../../../packages/logger'
import { RuntimeRegistryService } from '../../../services/runtime-registry.service'
import { getWorkenvById } from '../repository'
import type { ExecRequest, ExecSession, RuntimeAdapter, WorkenvHandle } from '../types/adapter'
import { plainEnv } from './bootstrap-steps'

interface ActiveStream {
  readonly workenvId: string
  readonly session: ExecSession
  readonly scrollback: string[]
  readonly maxScrollbackLines: number
  readonly exitCallbacks: Set<(code: number) => void>
  exitCode: number | null
}

const SCROLLBACK_LIMIT = 5000

export interface WorkenvExecShape {
  /** Spawn an exec session on a workenv. Returns the streamId. */
  readonly start: (workenvId: string, req: ExecRequest) => Effect.Effect<{ streamId: string }, Error>
  /** Hot-path stdin write. */
  readonly write: (streamId: string, data: string) => void
  /** Hot-path resize. */
  readonly resize: (streamId: string, cols: number, rows: number) => void
  /** Send a signal to the underlying process. */
  readonly signal: (streamId: string, sig: 'SIGINT' | 'SIGTERM' | 'SIGKILL') => void
  /** Tear down a session. */
  readonly destroy: (streamId: string) => void
  /** Subscribe to a session exit. Returns an unsubscribe function. */
  readonly onExit: (streamId: string, callback: (code: number) => void) => () => void
  /**
   * Snapshot of captured output + the exit code if the session has
   * already finished. `exitCode === null` means the session is still
   * running. Returned together so a late-subscribing renderer can
   * replay scrollback AND observe a completed session without racing
   * the `terminal:exit` broadcast.
   */
  readonly getScrollback: (streamId: string) => { scrollback: string; exitCode: number | null }
}

export class WorkenvExec extends Context.Tag('WorkenvExec')<WorkenvExec, WorkenvExecShape>() {}

export const WorkenvExecLive = Layer.effect(
  WorkenvExec,
  Effect.gen(function* () {
    const broadcaster = yield* Broadcaster
    const registry = yield* RuntimeRegistryService
    const db = yield* DatabaseService

    const streams = new Map<string, ActiveStream>()

    function pushScrollback(stream: ActiveStream, chunk: string): void {
      // Append + trim to a soft line cap. Cheap for typical bootstrap-step
      // output volumes; if a session blasts gigabytes it gets clipped.
      stream.scrollback.push(chunk)
      if (stream.scrollback.length > stream.maxScrollbackLines) {
        stream.scrollback.splice(0, stream.scrollback.length - stream.maxScrollbackLines)
      }
    }

    return {
      start: (workenvId, req) =>
        Effect.gen(function* () {
          const row = getWorkenvById(db, workenvId)
          if (!row) return yield* Effect.fail(new Error(`workenv ${workenvId} not found`))
          if (row.state !== 'running') {
            return yield* Effect.fail(new Error(`workenv ${workenvId} is ${row.state}; must be running to exec`))
          }
          const adapter = registry.get(row.runtime) as RuntimeAdapter | undefined
          if (!adapter) {
            return yield* Effect.fail(new Error(`No adapter registered for runtime '${row.runtime}'`))
          }
          if (!row.adapterHandle || !row.runtimeState) {
            return yield* Effect.fail(new Error(`workenv ${workenvId} has no adapter handle`))
          }

          const runtimeState = workenvRuntimeStateSchema.safeParse(row.runtimeState)
          if (!runtimeState.success) {
            return yield* Effect.fail(new Error(`workenv ${workenvId} has invalid runtime state`))
          }
          if (runtimeState.data.runtime !== row.runtime) {
            return yield* Effect.fail(
              new Error(`workenv ${workenvId} runtime state is for ${runtimeState.data.runtime}, not ${row.runtime}`),
            )
          }

          const handle: WorkenvHandle = {
            runtime: row.runtime,
            adapterHandle: row.adapterHandle,
            state: runtimeState.data,
          }

          const session = adapter.exec(handle, {
            ...req,
            env: { ...plainEnv(row.config.env), ...(req.env ?? {}) },
          })
          const stream: ActiveStream = {
            workenvId,
            session,
            scrollback: [],
            maxScrollbackLines: SCROLLBACK_LIMIT,
            exitCallbacks: new Set(),
            exitCode: null,
          }
          streams.set(session.id, stream)

          // Bridge the session's data + exit to the existing terminal:* channels
          // so the renderer's xterm.js plumbing handles them transparently.
          session.onData((data) => {
            pushScrollback(stream, data)
            broadcaster.send('terminal:data', session.id, data)
          })
          void session.exit.then((code) => {
            stream.exitCode = code
            broadcaster.send('terminal:exit', session.id, code)
            for (const callback of stream.exitCallbacks) callback(code)
            // Hold the entry for a beat so a late getScrollback() still
            // returns the tail + exit code; then GC.
            setTimeout(() => streams.delete(session.id), 30_000)
          })

          return { streamId: session.id }
        }),

      write: (streamId, data) => {
        const stream = streams.get(streamId)
        if (!stream) {
          log.pod.debug('workenv exec write: unknown streamId', { streamId })
          return
        }
        stream.session.write(data)
      },

      resize: (streamId, cols, rows) => {
        streams.get(streamId)?.session.resize(cols, rows)
      },

      signal: (streamId, sig) => {
        streams.get(streamId)?.session.signal(sig)
      },

      destroy: (streamId) => {
        const stream = streams.get(streamId)
        if (!stream) return
        stream.session.destroy()
        streams.delete(streamId)
      },

      onExit: (streamId, callback) => {
        const stream = streams.get(streamId)
        if (!stream) return () => {}
        stream.exitCallbacks.add(callback)
        return () => {
          stream.exitCallbacks.delete(callback)
        }
      },

      getScrollback: (streamId) => {
        const stream = streams.get(streamId)
        if (!stream) return { scrollback: '', exitCode: null }
        return { scrollback: stream.scrollback.join(''), exitCode: stream.exitCode }
      },
    }
  }),
)
