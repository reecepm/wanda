// -----------------------------------------------------------------------------
// workenv.* router — basic CRUD + lifecycle.
//
// exec / templates / adapters live in sibling files.
// Keeping the surface tight here so the renderer can drive create/start/
// stop/destroy/list without waiting on those.
// -----------------------------------------------------------------------------

import { ORPCError } from '@orpc/client'
import { Effect } from 'effect'
import { z } from 'zod'
import {
  type WorkenvProbeResult,
  type WorkenvRuntime,
  workenvBootstrapStepSchema,
  workenvConfigSchema,
  workenvRuntimeSchema,
} from '../../../shared/contracts/workenv'
import {
  RuntimeRegistryService,
  WorkenvController,
  WorkenvEvents,
  WorkenvExec,
  WorkenvReconciler,
  WorkenvTemplates,
} from '../../services'
import type { AppRouterDeps } from '../index'

function routeError(route: string, err: Error) {
  // eslint-disable-next-line no-console
  console.error(`[workenv-router] ${route} failed:`, err)
  return new ORPCError('INTERNAL_SERVER_ERROR', { message: err.message, cause: err })
}

const createWorkenvSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  config: workenvConfigSchema,
  templateId: z.string().nullish(),
})

const idInput = z.object({ id: z.string() })

const listEventsInput = z.object({
  id: z.string(),
  limit: z.number().int().positive().max(500).optional(),
})

export function workenvRoutes({ effectOs }: AppRouterDeps) {
  return {
    list: effectOs.effect(function* () {
      const svc = yield* WorkenvController
      return yield* svc.list()
    }),

    getById: effectOs.input(idInput).effect(function* ({ input }) {
      const svc = yield* WorkenvController
      return yield* svc.getById(input.id)
    }),

    create: effectOs.input(createWorkenvSchema).effect(function* ({ input }) {
      const svc = yield* WorkenvController
      return yield* svc.create(input).pipe(Effect.mapError((err) => routeError('create', err)))
    }),

    destroy: effectOs
      .input(
        z.object({
          id: z.string(),
          deletePods: z.boolean().optional(),
          withVolumes: z.boolean().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* WorkenvController
        return yield* svc
          .destroy(input.id, {
            deletePods: input.deletePods,
            withVolumes: input.withVolumes,
          })
          .pipe(Effect.mapError((err) => routeError(`destroy(${input.id})`, err)))
      }),

    /**
     * Apply a patch to an existing workenv. Response includes a change
     * report so the UI can prompt the user to restart/recreate — the
     * backend never auto-recreates a VM on config change.
     */
    update: effectOs
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).optional(),
          config: workenvConfigSchema.optional(),
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* WorkenvController
        const { id, ...patch } = input
        return yield* svc.update(id, patch).pipe(Effect.mapError((err) => routeError(`update(${id})`, err)))
      }),

    start: effectOs.input(idInput).effect(function* ({ input }) {
      const svc = yield* WorkenvController
      return yield* svc.start(input.id).pipe(Effect.mapError((err) => routeError(`start(${input.id})`, err)))
    }),

    stop: effectOs.input(idInput).effect(function* ({ input }) {
      const svc = yield* WorkenvController
      return yield* svc.stop(input.id).pipe(Effect.mapError((err) => routeError(`stop(${input.id})`, err)))
    }),

    restart: effectOs.input(idInput).effect(function* ({ input }) {
      const svc = yield* WorkenvController
      return yield* svc.restart(input.id).pipe(Effect.mapError((err) => routeError(`restart(${input.id})`, err)))
    }),

    listEvents: effectOs.input(listEventsInput).effect(function* ({ input }) {
      const events = yield* WorkenvEvents
      return yield* events.listForWorkenv(input.id, { limit: input.limit })
    }),

    /**
     * Spawn an exec session inside a running workenv. The returned
     * `streamId` flows through the existing `terminal:data` /
     * `terminal:exit` broadcast channels so the renderer can attach
     * xterm.js the same way it does for pod terminals.
     */
    execStart: effectOs
      .input(
        z.object({
          id: z.string(),
          cmd: z.string().min(1),
          args: z.array(z.string()).optional(),
          cwd: z.string().optional(),
          env: z.record(z.string(), z.string()).optional(),
          cols: z.number().int().positive().optional(),
          rows: z.number().int().positive().optional(),
          pty: z.boolean().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const exec = yield* WorkenvExec
        return yield* exec.start(input.id, {
          cmd: input.cmd,
          args: input.args,
          cwd: input.cwd,
          env: input.env,
          cols: input.cols,
          rows: input.rows,
          pty: input.pty ?? true,
        })
      }),

    execWrite: effectOs.input(z.object({ streamId: z.string(), data: z.string() })).effect(function* ({ input }) {
      const exec = yield* WorkenvExec
      exec.write(input.streamId, input.data)
      return { ok: true as const }
    }),

    execResize: effectOs
      .input(z.object({ streamId: z.string(), cols: z.number().int(), rows: z.number().int() }))
      .effect(function* ({ input }) {
        const exec = yield* WorkenvExec
        exec.resize(input.streamId, input.cols, input.rows)
        return { ok: true as const }
      }),

    execSignal: effectOs
      .input(z.object({ streamId: z.string(), sig: z.enum(['SIGINT', 'SIGTERM', 'SIGKILL']) }))
      .effect(function* ({ input }) {
        const exec = yield* WorkenvExec
        exec.signal(input.streamId, input.sig)
        return { ok: true as const }
      }),

    execDestroy: effectOs.input(z.object({ streamId: z.string() })).effect(function* ({ input }) {
      const exec = yield* WorkenvExec
      exec.destroy(input.streamId)
      return { ok: true as const }
    }),

    execGetScrollback: effectOs.input(z.object({ streamId: z.string() })).effect(function* ({ input }) {
      const exec = yield* WorkenvExec
      return exec.getScrollback(input.streamId)
    }),

    listTemplates: effectOs.effect(function* () {
      const tpls = yield* WorkenvTemplates
      return yield* tpls.list()
    }),

    listBuiltinLayers: effectOs.effect(function* () {
      const { BUILTIN_LAYERS } = yield* Effect.promise(() => import('../../domains/workenv/controller/builtin-layers'))
      return BUILTIN_LAYERS.map((e) => ({
        description: e.description,
        default: e.default ?? false,
        layer: e.layer,
      }))
    }),

    getTemplate: effectOs.input(idInput).effect(function* ({ input }) {
      const tpls = yield* WorkenvTemplates
      return yield* tpls.getById(input.id)
    }),

    createTemplate: effectOs
      .input(
        z.object({
          name: z.string().min(1),
          description: z.string().nullish(),
          runtime: z.enum(['orbstack']),
          config: workenvConfigSchema.partial(),
          sortOrder: z.number().int().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const tpls = yield* WorkenvTemplates
        return yield* tpls.create(input)
      }),

    updateTemplate: effectOs
      .input(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          description: z.string().nullish(),
          runtime: z.enum(['orbstack']).optional(),
          config: workenvConfigSchema.partial().optional(),
          sortOrder: z.number().int().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const tpls = yield* WorkenvTemplates
        const { id, ...rest } = input
        return yield* tpls.update(id, rest)
      }),

    deleteTemplate: effectOs.input(idInput).effect(function* ({ input }) {
      const tpls = yield* WorkenvTemplates
      return yield* tpls.delete(input.id)
    }),

    exportTemplateYaml: effectOs.input(idInput).effect(function* ({ input }) {
      const tpls = yield* WorkenvTemplates
      return yield* tpls
        .exportYaml(input.id)
        .pipe(Effect.mapError((err) => routeError(`exportTemplateYaml(${input.id})`, err)))
    }),

    importTemplateYaml: effectOs
      .input(
        z.object({
          yaml: z.string().min(1),
          replaceExisting: z.boolean().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const tpls = yield* WorkenvTemplates
        return yield* tpls
          .importYaml(input.yaml, { replaceExisting: input.replaceExisting })
          .pipe(Effect.mapError((err) => routeError('importTemplateYaml', err)))
      }),

    prebuildTemplate: effectOs.input(idInput).effect(function* ({ input }) {
      const svc = yield* WorkenvController
      return yield* svc
        .prebuildTemplate(input.id)
        .pipe(Effect.mapError((err) => routeError(`prebuildTemplate(${input.id})`, err)))
    }),

    getTemplatePrebuildStatus: effectOs.input(idInput).effect(function* ({ input }) {
      const svc = yield* WorkenvController
      return yield* svc
        .getTemplatePrebuildStatus(input.id)
        .pipe(Effect.mapError((err) => routeError(`getTemplatePrebuildStatus(${input.id})`, err)))
    }),

    /** Resolve `extends` refs and return the merged config. */
    compileConfig: effectOs.input(z.object({ config: workenvConfigSchema })).effect(function* ({ input }) {
      const tpls = yield* WorkenvTemplates
      return yield* tpls.compile(input.config)
    }),

    /**
     * Live availability probe for a single adapter. Cached 5s in the
     * registry; callers wanting fresh results after a user action should
     * invoke this on demand (not just subscribe).
     */
    probeAdapter: effectOs.input(z.object({ runtime: workenvRuntimeSchema })).effect(function* ({ input }) {
      const registry = yield* RuntimeRegistryService
      const result = yield* registry.probe(input.runtime)
      return { runtime: input.runtime, ...result } satisfies WorkenvProbeResult
    }),

    /** Probe every registered adapter in parallel. */
    probeAllAdapters: effectOs.effect(function* () {
      const registry = yield* RuntimeRegistryService
      const map = yield* registry.probeAll()
      const out: WorkenvProbeResult[] = []
      for (const runtime of Object.keys(map) as WorkenvRuntime[]) {
        out.push({ runtime, ...map[runtime] })
      }
      return out
    }),

    /**
     * Re-run the stranded-detection reconciler on demand. Also runs once on
     * server boot (see electron/server/runtime.ts).
     */
    reconcile: effectOs.effect(function* () {
      const svc = yield* WorkenvReconciler
      return yield* svc.reconcile()
    }),
  }
}

// Re-export so tests / callers can construct identical schemas without
// duplicating field lists.
export { createWorkenvSchema, workenvBootstrapStepSchema, workenvConfigSchema }
