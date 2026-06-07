import { z } from 'zod'
import { createWorkspaceSchema, updateWorkspaceSchema } from '../../domains/workspace/schemas'
import { log } from '../../packages/logger'
import { PodController, WorkspaceController } from '../../services'
import type { AppRouterDeps } from '../index'

export function workspaceRoutes({ effectOs, orpc }: AppRouterDeps) {
  return {
    list: effectOs.effect(function* () {
      const svc = yield* WorkspaceController
      return yield* svc.list()
    }),

    getById: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* WorkspaceController
      return yield* svc.getById(input.id)
    }),

    create: effectOs.input(createWorkspaceSchema).effect(function* ({ input }) {
      const svc = yield* WorkspaceController
      return yield* svc.create(input)
    }),

    update: effectOs.input(updateWorkspaceSchema).effect(function* ({ input }) {
      const svc = yield* WorkspaceController
      const { id, ...data } = input
      return yield* svc.update(id, data)
    }),

    delete: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      // Stop running pods before cascading delete
      const podSvc = yield* PodController
      yield* podSvc.stopAllForWorkspace(input.id)
      const svc = yield* WorkspaceController
      return yield* svc.delete(input.id)
    }),

    refreshIcon: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* WorkspaceController
      return yield* svc.refreshIcon(input.id)
    }),

    refreshAllIcons: effectOs.effect(function* () {
      const svc = yield* WorkspaceController
      return yield* svc.refreshAllIcons()
    }),

    runArchiveScript: orpc
      .input(
        z.object({
          script: z.string(),
          cwd: z.string(),
        }),
      )
      .handler(async ({ input }) => {
        // This endpoint intentionally executes user-configured shell
        // scripts stored in workspaceSettings.scriptArchive — it's a
        // feature, not a footgun. The RPC is guarded by the main
        // process's Bearer-session-token auth: only authorized callers
        // (local shell, or paired peers the user paired) can reach it.
        // Paired peers therefore inherit shell access; that is the
        // documented trust boundary of a paired session.
        const cp = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execFileAsync = promisify(cp.execFile)
        try {
          await execFileAsync('/bin/sh', ['-c', input.script], {
            cwd: input.cwd,
            timeout: 60_000,
          })
          return { success: true }
        } catch (err) {
          const stderr = (err as { stderr?: string }).stderr?.trim()
          const message = err instanceof Error ? err.message : String(err)
          log.main.warn('Archive script failed:', stderr || message)
          return { success: false, error: stderr || message }
        }
      }),
  }
}
