// ---------------------------------------------------------------------------
// Async scrollback persistence.
//
// All file I/O uses fs/promises to avoid blocking the event loop.
// Per-stream promise chains prevent write interleaving.
// Raw log writes are buffered and flushed periodically to reduce I/O ops.
//
// File format: {id}.snapshot (JSON meta + serialized state) and
// {id}.rawlog (append-only raw PTY data since last snapshot).
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_SNAPSHOT_SIZE = 2_000_000 // 2MB max per snapshot
const MAX_RAWLOG_SIZE = 5_000_000 // 5MB max raw log before forced trim

export interface SnapshotMeta {
  cols: number
  rows: number
  timestamp: number
  rawlogOffset: number
}

export type StoreErrorHandler = (context: string, error: unknown) => void

/** Sanitize stream ID for use as a filename. */
function safeFilename(streamId: string): string {
  return streamId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export class SnapshotStore {
  private dir: string
  private rawlogOffsets = new Map<string, number>()
  private chains = new Map<string, Promise<void>>()
  private rawlogBuffers = new Map<string, string[]>()
  private rawlogBufferBytes = new Map<string, number>()
  private rawlogFlushTimer: ReturnType<typeof setInterval> | null = null
  private onError: StoreErrorHandler

  private static readonly RAWLOG_FLUSH_INTERVAL = 500
  private static readonly RAWLOG_FLUSH_THRESHOLD = 256_000

  constructor(baseDir: string, onError?: StoreErrorHandler) {
    this.dir = join(baseDir, 'scrollback')
    this.onError = onError ?? ((ctx, err) => console.error(`[snapshot-store] ${ctx}:`, err))
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true })
    }
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
  }

  private chain(streamId: string, fn: () => Promise<void>): void {
    const prev = this.chains.get(streamId) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.chains.set(streamId, next)
  }

  async writeSnapshot(streamId: string, serialized: string, meta: SnapshotMeta): Promise<void> {
    return new Promise<void>((resolve) => {
      this.chain(streamId, async () => {
        try {
          const trimmed = serialized.length > MAX_SNAPSHOT_SIZE ? serialized.slice(-MAX_SNAPSHOT_SIZE) : serialized
          const content = `${JSON.stringify(meta)}\n${trimmed}`
          const filePath = join(this.dir, `${safeFilename(streamId)}.snapshot`)
          const tmpPath = `${filePath}.tmp`
          await writeFile(tmpPath, content, 'utf-8')
          await rename(tmpPath, filePath)

          // Truncate raw log — data before the snapshot offset is now redundant
          const rawlogPath = join(this.dir, `${safeFilename(streamId)}.rawlog`)
          try {
            const stats = await stat(rawlogPath)
            const bytesToKeep = stats.size - meta.rawlogOffset
            if (bytesToKeep <= 0) {
              await writeFile(rawlogPath, '', 'utf-8')
              this.rawlogOffsets.set(streamId, 0)
            } else {
              const raw = await readFile(rawlogPath, 'utf-8')
              await writeFile(rawlogPath, raw.slice(meta.rawlogOffset), 'utf-8')
              this.rawlogOffsets.set(streamId, 0)
            }
          } catch (err: unknown) {
            // ENOENT is expected — rawlog may not exist yet for new streams
            if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return
            this.onError(`snapshot-truncate:${streamId}`, err)
          }
        } catch (err) {
          this.onError(`snapshot-write:${streamId}`, err)
        }
        resolve()
      })
    })
  }

  async readSnapshot(streamId: string): Promise<{ meta: SnapshotMeta; serialized: string } | null> {
    try {
      const filePath = join(this.dir, `${safeFilename(streamId)}.snapshot`)
      const content = await readFile(filePath, 'utf-8')
      const newlineIdx = content.indexOf('\n')
      if (newlineIdx === -1) return null
      const meta: SnapshotMeta = JSON.parse(content.slice(0, newlineIdx))
      if (typeof meta.cols !== 'number' || typeof meta.rows !== 'number') return null
      const serialized = content.slice(newlineIdx + 1)
      return { meta, serialized }
    } catch (err: unknown) {
      // ENOENT is expected — snapshot may not exist yet
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return null
      this.onError(`snapshot-read:${streamId}`, err)
      return null
    }
  }

  /** Append raw PTY data to the stream's buffered log. Flushed periodically to disk. */
  appendRawLog(streamId: string, data: string): void {
    const offset = (this.rawlogOffsets.get(streamId) ?? 0) + data.length
    this.rawlogOffsets.set(streamId, offset)

    let buf = this.rawlogBuffers.get(streamId)
    if (!buf) {
      buf = []
      this.rawlogBuffers.set(streamId, buf)
    }
    buf.push(data)
    const bytes = (this.rawlogBufferBytes.get(streamId) ?? 0) + data.length
    this.rawlogBufferBytes.set(streamId, bytes)

    if (!this.rawlogFlushTimer) {
      this.rawlogFlushTimer = setInterval(() => this.flushAllRawLogs(), SnapshotStore.RAWLOG_FLUSH_INTERVAL)
    }

    if (bytes >= SnapshotStore.RAWLOG_FLUSH_THRESHOLD) {
      this.flushRawLog(streamId)
    }
  }

  private flushRawLog(streamId: string): void {
    const buf = this.rawlogBuffers.get(streamId)
    if (!buf || buf.length === 0) return
    const combined = buf.join('')
    this.rawlogBuffers.set(streamId, [])
    this.rawlogBufferBytes.set(streamId, 0)

    const offset = this.rawlogOffsets.get(streamId) ?? 0

    this.chain(streamId, async () => {
      try {
        const rawlogPath = join(this.dir, `${safeFilename(streamId)}.rawlog`)
        await appendFile(rawlogPath, combined, 'utf-8')

        if (offset > MAX_RAWLOG_SIZE) {
          const content = await readFile(rawlogPath, 'utf-8')
          const trimmed = content.slice(-MAX_RAWLOG_SIZE)
          await writeFile(rawlogPath, trimmed, 'utf-8')
          this.rawlogOffsets.set(streamId, trimmed.length)
        }
      } catch (err) {
        this.onError(`rawlog-flush:${streamId}`, err)
      }
    })
  }

  private flushAllRawLogs(): void {
    for (const streamId of this.rawlogBuffers.keys()) {
      this.flushRawLog(streamId)
    }
  }

  getRawLogOffset(streamId: string): number {
    return this.rawlogOffsets.get(streamId) ?? 0
  }

  async readRawLogFrom(streamId: string, offset: number): Promise<string> {
    try {
      const rawlogPath = join(this.dir, `${safeFilename(streamId)}.rawlog`)
      const content = await readFile(rawlogPath, 'utf-8')
      return offset < content.length ? content.slice(offset) : ''
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return ''
      this.onError(`rawlog-read:${streamId}`, err)
      return ''
    }
  }

  async delete(streamId: string): Promise<void> {
    const base = safeFilename(streamId)
    const tryUnlink = async (ext: string) => {
      try {
        await unlink(join(this.dir, `${base}${ext}`))
      } catch (err: unknown) {
        // ENOENT is expected — the file may not exist
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.onError(`delete:${streamId}${ext}`, err)
        }
      }
    }
    await Promise.all([tryUnlink('.snapshot'), tryUnlink('.rawlog'), tryUnlink('.log')])
    this.rawlogOffsets.delete(streamId)
    this.rawlogBuffers.delete(streamId)
    this.rawlogBufferBytes.delete(streamId)
    this.chains.delete(streamId)
  }

  async clear(): Promise<void> {
    if (this.rawlogFlushTimer) {
      clearInterval(this.rawlogFlushTimer)
      this.rawlogFlushTimer = null
    }
    this.flushAllRawLogs()
    try {
      const files = await readdir(this.dir)
      await Promise.all(
        files
          .filter((f) => f.endsWith('.snapshot') || f.endsWith('.rawlog') || f.endsWith('.log'))
          .map((f) =>
            unlink(join(this.dir, f)).catch((err: unknown) => {
              this.onError(`clear:${f}`, err)
            }),
          ),
      )
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.onError('clear-readdir', err)
      }
    }
    this.rawlogOffsets.clear()
    this.rawlogBuffers.clear()
    this.rawlogBufferBytes.clear()
    this.chains.clear()
  }
}
