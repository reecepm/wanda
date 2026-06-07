import type { Context } from 'effect'
import { Effect } from 'effect'
import { log } from '../../../../packages/logger'
import type { WorkenvController, WorkenvExec } from '../../../workenv'
import type { ExecRequest } from '../../../workenv/types/adapter'
import type { PodRuntimeState } from './state'

type WorkenvCtl = Context.Tag.Service<typeof WorkenvController>
type WorkenvExecSvc = Context.Tag.Service<typeof WorkenvExec>

const WORKENV_READY_TIMEOUT_MS = 30 * 60 * 1000
const WORKENV_READY_POLL_MS = 1_000

function sleep(ms: number): Effect.Effect<void> {
  return Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))
}

/** Handles pod terminals that exec inside an attached workenv VM. */
export interface WorkenvAttach {
  /** Block until the attached workenv reaches `running`, auto-starting it when stopped. */
  readonly ensureReadyForTerminal: (podId: string, workenvId: string) => Effect.Effect<void, Error>
  /** Start a single terminal inside the workenv VM and register its exit handler. */
  readonly startTerminal: (
    podId: string,
    workenvId: string,
    terminalId: string,
    req: ExecRequest,
  ) => Effect.Effect<string, Error>
  /** Tear down a workenv exec stream. */
  readonly destroyStream: (streamId: string) => void
}

export function makeWorkenvAttach(
  state: PodRuntimeState,
  workenvCtl: WorkenvCtl,
  workenvExec: WorkenvExecSvc,
  onTerminalExit: (terminalId: string, podId: string, exitCode: number) => void,
): WorkenvAttach {
  function waitForWorkenvReady(workenvId: string): Effect.Effect<void, Error> {
    return Effect.gen(function* () {
      const startedAt = Date.now()
      while (Date.now() - startedAt < WORKENV_READY_TIMEOUT_MS) {
        const row = yield* workenvCtl.getById(workenvId)
        if (!row) return yield* Effect.fail(new Error(`attached workenv ${workenvId} not found`))
        if (row.state === 'running') return
        if (row.state === 'error') {
          return yield* Effect.fail(new Error(row.lastError ?? `workenv ${workenvId} failed to start`))
        }
        if (row.state !== 'starting' && row.state !== 'creating') {
          return yield* Effect.fail(new Error(`workenv ${workenvId} is ${row.state}, not ready for terminal exec`))
        }
        yield* sleep(WORKENV_READY_POLL_MS)
      }
      return yield* Effect.fail(new Error(`Timed out waiting for workenv ${workenvId} to start`))
    })
  }

  function ensureReadyForTerminal(podId: string, workenvId: string): Effect.Effect<void, Error> {
    return Effect.gen(function* () {
      const row = yield* workenvCtl.getById(workenvId)
      if (!row) return yield* Effect.fail(new Error(`attached workenv ${workenvId} not found`))
      if (row.state === 'running') return
      if (row.state === 'starting' || row.state === 'creating') {
        log.pod.info(`pod ${podId}: workenv ${workenvId} is ${row.state}, waiting before terminal exec`)
        return yield* waitForWorkenvReady(workenvId)
      }

      log.pod.info(`pod ${podId}: workenv ${workenvId} is ${row.state}, starting before terminal exec`)
      const startResult = yield* Effect.either(workenvCtl.start(workenvId))
      if (startResult._tag === 'Left') {
        return yield* Effect.fail(startResult.left)
      }
    })
  }

  function startTerminal(
    podId: string,
    workenvId: string,
    terminalId: string,
    req: ExecRequest,
  ): Effect.Effect<string, Error> {
    return Effect.gen(function* () {
      const result = yield* workenvExec.start(workenvId, req)
      state.streamMap.set(terminalId, result.streamId)
      workenvExec.onExit(result.streamId, (code) => onTerminalExit(terminalId, podId, code))
      return result.streamId
    })
  }

  return {
    ensureReadyForTerminal,
    startTerminal,
    destroyStream: (streamId) => workenvExec.destroy(streamId),
  }
}
