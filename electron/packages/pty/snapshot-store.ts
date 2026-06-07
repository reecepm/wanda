import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { log } from '../logger'

const MAX_SNAPSHOT_SIZE = 2_000_000 // 2MB max per snapshot
const MAX_RAWLOG_SIZE = 5_000_000 // 5MB max raw log before forced trim

export interface SnapshotMeta {
  cols: number
  rows: number
  timestamp: number
  rawlogOffset: number
}

/** Sanitize stream ID for use as a filename */
function safeFilename(streamId: string): string {
  return streamId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * Two-file scrollback persistence per stream:
 * - {id}.snapshot — JSON metadata + serialized terminal state
 * - {id}.rawlog  — append-only raw PTY data since last snapshot
 *
 * Snapshot writes are atomic (temp + rename). Raw log is append-only,
 * truncated when a new snapshot is written.
 */
export class SnapshotStore {
  private dir: string
  private rawlogOffsets = new Map<string, number>()

  constructor(baseDir: string) {
    this.dir = join(baseDir, 'scrollback')
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true })
    }
  }

  writeSnapshot(streamId: string, serialized: string, meta: SnapshotMeta): void {
    try {
      // Trim serialized data if too large
      const trimmed = serialized.length > MAX_SNAPSHOT_SIZE ? serialized.slice(-MAX_SNAPSHOT_SIZE) : serialized
      const content = `${JSON.stringify(meta)}\n${trimmed}`
      const filePath = join(this.dir, `${safeFilename(streamId)}.snapshot`)
      const tmpPath = `${filePath}.tmp`
      writeFileSync(tmpPath, content, 'utf-8')
      renameSync(tmpPath, filePath)

      // Truncate raw log — data before the snapshot offset is now redundant
      const rawlogPath = join(this.dir, `${safeFilename(streamId)}.rawlog`)
      if (existsSync(rawlogPath)) {
        const currentSize = statSync(rawlogPath).size
        const bytesToKeep = currentSize - meta.rawlogOffset
        if (bytesToKeep <= 0) {
          // All raw data is captured in the snapshot — clear the log
          writeFileSync(rawlogPath, '', 'utf-8')
          this.rawlogOffsets.set(streamId, 0)
        } else {
          // Keep only the tail that's newer than the snapshot
          const tail = readFileSync(rawlogPath, 'utf-8').slice(meta.rawlogOffset)
          writeFileSync(rawlogPath, tail, 'utf-8')
          this.rawlogOffsets.set(streamId, 0)
        }
      }
    } catch (err) {
      log.pty.error(`Failed to write snapshot for ${streamId}:`, err)
    }
  }

  readSnapshot(streamId: string): { meta: SnapshotMeta; serialized: string } | null {
    try {
      const filePath = join(this.dir, `${safeFilename(streamId)}.snapshot`)
      if (!existsSync(filePath)) return null
      const content = readFileSync(filePath, 'utf-8')
      const newlineIdx = content.indexOf('\n')
      if (newlineIdx === -1) return null
      const meta: SnapshotMeta = JSON.parse(content.slice(0, newlineIdx))
      if (typeof meta.cols !== 'number' || typeof meta.rows !== 'number') return null
      const serialized = content.slice(newlineIdx + 1)
      return { meta, serialized }
    } catch {
      return null
    }
  }

  appendRawLog(streamId: string, data: string): void {
    try {
      const rawlogPath = join(this.dir, `${safeFilename(streamId)}.rawlog`)
      appendFileSync(rawlogPath, data, 'utf-8')
      const offset = (this.rawlogOffsets.get(streamId) ?? 0) + data.length
      this.rawlogOffsets.set(streamId, offset)

      // Force trim if raw log grows too large
      if (offset > MAX_RAWLOG_SIZE) {
        const trimmed = readFileSync(rawlogPath, 'utf-8').slice(-MAX_RAWLOG_SIZE)
        writeFileSync(rawlogPath, trimmed, 'utf-8')
        this.rawlogOffsets.set(streamId, trimmed.length)
      }
    } catch (err) {
      log.pty.error(`Failed to append raw log for ${streamId}:`, err)
    }
  }

  getRawLogOffset(streamId: string): number {
    return this.rawlogOffsets.get(streamId) ?? 0
  }

  readRawLogFrom(streamId: string, offset: number): string {
    try {
      const rawlogPath = join(this.dir, `${safeFilename(streamId)}.rawlog`)
      if (!existsSync(rawlogPath)) return ''
      const content = readFileSync(rawlogPath, 'utf-8')
      return offset < content.length ? content.slice(offset) : ''
    } catch {
      return ''
    }
  }

  /** Read raw data from old-format .log files (migration fallback) */
  readLegacy(streamId: string): string {
    try {
      const filePath = join(this.dir, `${safeFilename(streamId)}.log`)
      if (!existsSync(filePath)) return ''
      return readFileSync(filePath, 'utf-8')
    } catch {
      return ''
    }
  }

  // Best-effort FS cleanup for snapshot/rawlog files. existsSync is racy
  // with concurrent writers, and unlinkSync may hit EACCES / ENOENT on
  // systems with stricter FS permissions. Errors are non-fatal — the next
  // sweep picks up whatever survived — so we swallow silently rather
  // than log-spam on every missing file.
  delete(streamId: string): void {
    const base = safeFilename(streamId)
    try {
      const snap = join(this.dir, `${base}.snapshot`)
      if (existsSync(snap)) unlinkSync(snap)
    } catch {}
    try {
      const raw = join(this.dir, `${base}.rawlog`)
      if (existsSync(raw)) unlinkSync(raw)
    } catch {}
    try {
      const legacy = join(this.dir, `${base}.log`)
      if (existsSync(legacy)) unlinkSync(legacy)
    } catch {}
    this.rawlogOffsets.delete(streamId)
  }

  clear(): void {
    try {
      for (const file of readdirSync(this.dir)) {
        if (file.endsWith('.snapshot') || file.endsWith('.rawlog') || file.endsWith('.log')) {
          unlinkSync(join(this.dir, file))
        }
      }
    } catch {}
    this.rawlogOffsets.clear()
  }
}
