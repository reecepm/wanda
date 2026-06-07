// -----------------------------------------------------------------------------
// BootstrapRunner — executes a workenv's `bootstrap` steps sequentially
// against the adapter, emitting persisted events + WS progress
// broadcasts and aborting on the first failure.
//
// v1 supports `shell`, guest `script`, and host-local `hostScript` steps;
// `recipe` is rejected with a clear error.
//
// Idempotency: if a step has `idempotencyKey`, the runner first checks
// for a `bootstrap.step.completed` event with the same key on this
// workenv; if found, the step is skipped. This is the durable form of
// `if [ -f /opt/wanda/bootstrap/install-v1 ]; then exit 0; fi`.
// -----------------------------------------------------------------------------

import { Context, Effect, Layer } from 'effect'
import type { WorkenvBootstrapStatus, WorkenvBootstrapStep } from '../../../../shared/contracts/workenv'
import { Broadcaster } from '../../../infra/broadcaster'
import { DatabaseService } from '../../../infra/database'
import { listEventsForWorkenv } from '../repository/events'
import { getWorkenvById } from '../repository/workenvs'
import type { RuntimeAdapter, WorkenvHandle } from '../types/adapter'
import { bootstrapStepName, execRequestForBootstrapStep, plainEnv } from './bootstrap-steps'
import { WorkenvEvents } from './events'

export interface BootstrapResult {
  readonly succeeded: number
  readonly failed: number
  readonly total: number
  readonly failedStep?: { readonly index: number; readonly step: WorkenvBootstrapStep; readonly error: string }
}

export interface BootstrapRunnerShape {
  /**
   * Run `steps` against `handle` for `workenvId`. Persists per-step
   * events, broadcasts `workenv.bootstrap.progress`, and aborts on the
   * first failure. Returns counts; the controller decides how to
   * advance the workenv state.
   *
   * The adapter is passed explicitly (not pulled via RuntimeRegistry)
   * because the controller already has it in scope and re-resolving it
   * here would just push registry coupling down the tree.
   */
  readonly run: (
    workenvId: string,
    steps: readonly WorkenvBootstrapStep[],
    handle: WorkenvHandle,
    adapter?: RuntimeAdapter,
  ) => Effect.Effect<BootstrapResult>
}

export class BootstrapRunner extends Context.Tag('BootstrapRunner')<BootstrapRunner, BootstrapRunnerShape>() {}

// ---- Internals -------------------------------------------------------------

async function runStep(
  adapter: RuntimeAdapter,
  handle: WorkenvHandle,
  step: WorkenvBootstrapStep,
  env: Record<string, string>,
): Promise<{ exitCode: number; output: string }> {
  const session = adapter.exec(handle, execRequestForBootstrapStep(step, env))
  let output = ''
  session.onData((chunk) => {
    output += chunk
  })
  const exitCode = await session.exit
  return { exitCode, output }
}

// ---- Live layer ------------------------------------------------------------

export const BootstrapRunnerLive = Layer.effect(
  BootstrapRunner,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const events = yield* WorkenvEvents
    const broadcaster = yield* Broadcaster

    function progress(workenvId: string, index: number, name: string, status: WorkenvBootstrapStatus): void {
      broadcaster.send('workenv.bootstrap.progress', workenvId, index, name, status)
    }

    return {
      run: (workenvId, steps, handle, adapter) =>
        Effect.gen(function* () {
          const total = steps.length
          const firstStep = steps[0]
          if (total === 0 || !firstStep) {
            return { succeeded: 0, failed: 0, total: 0, failedStep: undefined }
          }

          // Pull workenv config for env interpolation. The handle alone
          // doesn't carry the user's env definitions.
          const w = getWorkenvById(db, workenvId)
          if (!w) {
            return {
              succeeded: 0,
              failed: 1,
              total,
              failedStep: {
                index: 0,
                step: firstStep,
                error: `workenv ${workenvId} not found`,
              },
            }
          }

          if (!adapter) {
            return {
              succeeded: 0,
              failed: 1,
              total,
              failedStep: {
                index: 0,
                step: firstStep,
                error: 'no adapter provided to BootstrapRunner.run',
              },
            }
          }

          const env = {
            ...plainEnv(w.config.env),
            WANDA_WORKENV_ID: w.id,
            WANDA_WORKENV_NAME: w.name,
            WANDA_WORKENV_SLUG: w.slug,
            WANDA_WORKTREE_PATH: w.worktreePath,
            ...(w.config.workdir ? { WANDA_WORKDIR: w.config.workdir } : {}),
          }

          // Look up previously-completed idempotency keys (one DB round-trip
          // up front; the bootstrap event volume per workenv is bounded).
          const history = listEventsForWorkenv(db, workenvId)
          const completedKeys = new Set<string>()
          for (const e of history) {
            if (e.type === 'bootstrap.step.completed') {
              const key = (e.payload as { idempotencyKey?: unknown } | null)?.idempotencyKey
              if (typeof key === 'string') completedKeys.add(key)
            }
          }

          yield* events.append({ workenvId, type: 'bootstrap.started', payload: { total } })

          let succeeded = 0
          let failed = 0
          let failedStep: BootstrapResult['failedStep']

          for (const [i, step] of steps.entries()) {
            const name = bootstrapStepName(step)
            const idempotencyKey = step.kind !== 'recipe' ? step.idempotencyKey : undefined

            if (idempotencyKey && completedKeys.has(idempotencyKey)) {
              // Idempotent skip — neither broadcast nor count toward succeeded.
              continue
            }

            progress(workenvId, i, name, 'started')
            yield* events.append({
              workenvId,
              type: 'bootstrap.step.started',
              payload: { index: i, step },
            })

            // Recipe steps are deferred to v1.x — short-circuit with a
            // typed failure rather than letting Effect.tryPromise mask
            // the error string with its generic wrapper text.
            if (step.kind === 'recipe') {
              const errMsg = `recipe steps are not implemented in v1 (ref: ${step.ref})`
              failed++
              failedStep = { index: i, step, error: errMsg }
              yield* events.append({
                workenvId,
                type: 'bootstrap.step.failed',
                payload: { index: i, step, error: errMsg },
              })
              progress(workenvId, i, name, 'failed')
              break
            }

            // Adapter exec is raw / hot-path — wrap in tryPromise.
            const result = yield* Effect.either(
              Effect.tryPromise({
                try: () => runStep(adapter, handle, step, env),
                catch: (err) => (err instanceof Error ? err : new Error(String(err))),
              }),
            )

            if (result._tag === 'Left' || (result._tag === 'Right' && result.right.exitCode !== 0)) {
              // Include the last ~600 chars of output so the user sees the
              // actual error from apt/curl/whatever, not just an exit code.
              const tail = (output: string) => {
                const trimmed = output.trim()
                return trimmed.length > 600 ? `…${trimmed.slice(-600)}` : trimmed
              }
              const errMsg =
                result._tag === 'Left'
                  ? result.left instanceof Error
                    ? result.left.message
                    : String(result.left)
                  : `exit ${result.right.exitCode}: ${tail(result.right.output)}`
              failed++
              failedStep = { index: i, step, error: errMsg }
              yield* events.append({
                workenvId,
                type: 'bootstrap.step.failed',
                payload: { index: i, step, error: errMsg, ...(idempotencyKey ? { idempotencyKey } : {}) },
              })
              progress(workenvId, i, name, 'failed')
              break
            }

            succeeded++
            yield* events.append({
              workenvId,
              type: 'bootstrap.step.completed',
              payload: { index: i, step, ...(idempotencyKey ? { idempotencyKey } : {}) },
            })
            progress(workenvId, i, name, 'succeeded')
          }

          yield* events.append({
            workenvId,
            type: 'bootstrap.completed',
            payload: { succeeded, failed, total, ...(failedStep ? { failedAt: failedStep.index } : {}) },
          })

          return { succeeded, failed, total, failedStep }
        }),
    }
  }),
)
