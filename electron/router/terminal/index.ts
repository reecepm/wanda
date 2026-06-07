import { z } from 'zod'
import type { AppRouterDeps } from '../index'

export function terminalRoutes({ orpc, targetManager, workenvExec }: AppRouterDeps) {
  return {
    getScrollback: orpc.input(z.object({ id: z.string() })).handler(async ({ input }) => {
      if (targetManager?.hasStream?.(input.id)) {
        return targetManager.getScrollback(input.id)
      }
      // Fallback: workenv exec streams aren't registered with the target
      // manager. Try the workenv exec scrollback registry instead. Return
      // only the `scrollback` string to match the pod-terminal shape —
      // exit code is available on `workenv.execGetScrollback`.
      return workenvExec?.getScrollback(input.id).scrollback ?? ''
    }),

    /**
     * Write bytes to a stream's stdin. Fire-and-forget — the caller doesn't
     * need to meaningfully await this. In subprocess mode this is the hot
     * path for keystrokes.
     */
    write: orpc.input(z.object({ id: z.string(), data: z.string() })).handler(async ({ input }) => {
      if (targetManager?.hasStream?.(input.id)) {
        targetManager.writeStream(input.id, input.data)
        return
      }
      workenvExec?.write(input.id, input.data)
    }),

    /** Resize a stream. Fire-and-forget like `write`. */
    resize: orpc
      .input(z.object({ id: z.string(), cols: z.number().int(), rows: z.number().int() }))
      .handler(async ({ input }) => {
        if (targetManager?.hasStream?.(input.id)) {
          targetManager.resizeStream(input.id, input.cols, input.rows)
          return
        }
        workenvExec?.resize(input.id, input.cols, input.rows)
      }),

    /**
     * Drop captured scrollback for a stream — both the in-memory headless
     * buffer and the on-disk snapshot/rawlog. The PTY process keeps
     * running; only the history is cleared. The xterm-side buffer must
     * be cleared separately by the caller.
     */
    clear: orpc.input(z.object({ id: z.string() })).handler(async ({ input }) => {
      if (!targetManager) return
      targetManager.clearStream(input.id)
    }),
  }
}
