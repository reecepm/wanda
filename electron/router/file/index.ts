import { Effect } from 'effect'
import { z } from 'zod'
import { FileAccessError, FileService, PodCrudController, resolveSafe } from '../../services'
import { selectMarkdownFile } from '../helpers'
import type { AppRouterDeps } from '../index'

/**
 * File I/O routes for editor views (markdown, etc).
 *
 * All paths are **relative to the pod's cwd**. Server-side we look up the pod,
 * resolve the absolute path, and reject anything that escapes the pod root.
 */
export function fileRoutes({ effectOs }: AppRouterDeps) {
  return {
    read: effectOs.input(z.object({ podId: z.string(), relPath: z.string() })).effect(function* ({ input }) {
      const pods = yield* PodCrudController
      const files = yield* FileService
      const pod = yield* pods.getById(input.podId)
      if (!pod) return yield* Effect.fail(new FileAccessError(`Pod ${input.podId} not found`))
      const absPath = resolveSafe(pod.cwd, input.relPath)
      const content = yield* files.readFile(absPath)
      const mtimeMs = yield* files.statMtime(absPath)
      return { content, mtimeMs: mtimeMs ?? 0 }
    }),

    write: effectOs.input(z.object({ podId: z.string(), relPath: z.string(), content: z.string() })).effect(function* ({
      input,
    }) {
      const pods = yield* PodCrudController
      const files = yield* FileService
      const pod = yield* pods.getById(input.podId)
      if (!pod) return yield* Effect.fail(new FileAccessError(`Pod ${input.podId} not found`))
      const absPath = resolveSafe(pod.cwd, input.relPath)
      yield* files.writeFile(absPath, input.content)
      const mtimeMs = yield* files.statMtime(absPath)
      return { mtimeMs: mtimeMs ?? 0 }
    }),

    /**
     * Opens a native file picker rooted at the pod's cwd. Returns the picked
     * file path relative to the pod cwd, or null if the user cancels or picks
     * outside the pod root.
     */
    pickMarkdownFile: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const pods = yield* PodCrudController
      const pod = yield* pods.getById(input.podId)
      if (!pod) return { relPath: null as string | null }
      const relPath = yield* Effect.promise(() => selectMarkdownFile(pod.cwd))
      return { relPath }
    }),

    /**
     * Start a chokidar watcher on a file inside a pod. Change events are
     * broadcast via `file:changed` (see runtime.ts). The renderer uses this
     * for external-edit detection in the markdown editor.
     */
    watch: effectOs.input(z.object({ watchId: z.string(), podId: z.string(), relPath: z.string() })).effect(function* ({
      input,
    }) {
      const pods = yield* PodCrudController
      const files = yield* FileService
      const pod = yield* pods.getById(input.podId)
      if (!pod) return yield* Effect.fail(new FileAccessError(`Pod ${input.podId} not found`))
      const absPath = resolveSafe(pod.cwd, input.relPath)
      files.startWatch(input.watchId, absPath)
    }),

    unwatch: effectOs.input(z.object({ watchId: z.string() })).effect(function* ({ input }) {
      const files = yield* FileService
      files.stopWatch(input.watchId)
    }),
  }
}
