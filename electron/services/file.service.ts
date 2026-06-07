import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { type FSWatcher, watch } from 'chokidar'
import { Context, Effect, Layer } from 'effect'

/**
 * FileService — read/write files with atomic writes and change watching.
 *
 * Effect methods (readFile/writeFile) handle errors. Watcher methods are raw sync
 * so they can be driven directly from main.ts IPC handlers (matches PtyService pattern).
 *
 * Path containment check: `resolveSafe` rejects any path that escapes its root.
 */
export class FileAccessError extends Error {
  readonly _tag = 'FileAccessError'
  constructor(message: string) {
    super(message)
    this.name = 'FileAccessError'
  }
}

export type FileChangeCallback = (watchId: string, mtimeMs: number) => void

export interface FileServiceShape {
  readonly readFile: (absPath: string) => Effect.Effect<string, FileAccessError>
  readonly writeFile: (absPath: string, content: string) => Effect.Effect<void, FileAccessError>
  readonly statMtime: (absPath: string) => Effect.Effect<number | null>

  // Watcher management — sync hot-path methods. Called from main.ts direct-IPC handlers.
  readonly startWatch: (watchId: string, absPath: string) => void
  readonly stopWatch: (watchId: string) => void
  readonly setChangeCallback: (cb: FileChangeCallback | null) => void
  readonly cleanupAll: () => void
}

export class FileService extends Context.Tag('FileService')<FileService, FileServiceShape>() {}

/**
 * Resolve a relative path against a root directory, rejecting anything that escapes.
 * Returns the absolute path, or throws FileAccessError.
 */
export function resolveSafe(root: string, relPath: string): string {
  const absRoot = path.resolve(root)
  const absTarget = path.resolve(absRoot, relPath)
  const rel = path.relative(absRoot, absTarget)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new FileAccessError(`Path ${relPath} escapes workspace root ${absRoot}`)
  }
  return absTarget
}

export const FileServiceLive = Layer.sync(FileService, () => {
  const watchers = new Map<string, FSWatcher>()
  const debouncers = new Map<string, ReturnType<typeof setTimeout>>()
  let changeCallback: FileChangeCallback | null = null

  const stopWatch = (watchId: string) => {
    const w = watchers.get(watchId)
    if (w) {
      void w.close()
      watchers.delete(watchId)
    }
    const t = debouncers.get(watchId)
    if (t) clearTimeout(t)
    debouncers.delete(watchId)
  }

  return {
    readFile: (absPath) =>
      Effect.tryPromise({
        try: () => fsp.readFile(absPath, 'utf-8'),
        catch: (e) => new FileAccessError(`Failed to read ${absPath}: ${String(e)}`),
      }),

    writeFile: (absPath, content) =>
      Effect.tryPromise({
        try: async () => {
          // Atomic write: write to tmp sibling, then rename into place.
          const dir = path.dirname(absPath)
          const tmpPath = path.join(dir, `.${path.basename(absPath)}.${process.pid}.${Date.now()}.tmp`)
          await fsp.writeFile(tmpPath, content, 'utf-8')
          await fsp.rename(tmpPath, absPath)
        },
        catch: (e) => new FileAccessError(`Failed to write ${absPath}: ${String(e)}`),
      }),

    statMtime: (absPath) =>
      Effect.sync(() => {
        try {
          return fs.statSync(absPath).mtimeMs
        } catch {
          return null
        }
      }),

    startWatch: (watchId, absPath) => {
      // Replace any existing watcher for this id
      stopWatch(watchId)

      const w = watch(absPath, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      })

      const fire = () => {
        const existing = debouncers.get(watchId)
        if (existing) clearTimeout(existing)
        debouncers.set(
          watchId,
          setTimeout(() => {
            debouncers.delete(watchId)
            try {
              const stat = fs.statSync(absPath)
              changeCallback?.(watchId, stat.mtimeMs)
            } catch {
              // file may have been deleted or temporarily absent (atomic rename)
            }
          }, 150),
        )
      }

      w.on('change', fire)
      w.on('add', fire)

      watchers.set(watchId, w)
    },

    stopWatch,

    setChangeCallback: (cb) => {
      changeCallback = cb
    },

    cleanupAll: () => {
      for (const w of watchers.values()) void w.close()
      watchers.clear()
      for (const t of debouncers.values()) clearTimeout(t)
      debouncers.clear()
      changeCallback = null
    },
  }
})
