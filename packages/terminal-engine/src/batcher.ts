// ---------------------------------------------------------------------------
// Output batcher — accumulates PTY data chunks per terminal and flushes on
// a timer interval or size threshold, whichever fires first.
//
// Uses array-based buffering (push chunks, join on flush) instead of
// string concatenation to avoid O(n²) copy cost that causes OOM under
// heavy load with many terminals.
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 4 // 4ms — fast enough that input echo isn't delayed
const DEFAULT_MAX_BYTES = 128_000 // 128KB per flush

export interface BatcherOptions {
  /** Flush interval in ms (default 4). */
  intervalMs?: number
  /** Max bytes before immediate flush (default 128_000). */
  maxBytes?: number
}

export type FlushCallback = (id: string, data: string, byteCount: number) => void

export class Batcher {
  private chunks = new Map<string, string[]>()
  private bufferBytes = new Map<string, number>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly intervalMs: number
  private readonly maxBytes: number
  private readonly onFlush: FlushCallback

  constructor(onFlush: FlushCallback, opts?: BatcherOptions) {
    this.onFlush = onFlush
    this.intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS
    this.maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES
  }

  /** Accumulate data for a terminal. Triggers flush if size threshold is reached. */
  push(id: string, data: string): void {
    let arr = this.chunks.get(id)
    if (!arr) {
      arr = []
      this.chunks.set(id, arr)
    }
    arr.push(data)
    const byteLen = (this.bufferBytes.get(id) ?? 0) + data.length
    this.bufferBytes.set(id, byteLen)

    // Size threshold → immediate flush
    if (byteLen >= this.maxBytes) {
      this.flush(id)
      return
    }

    // Arm timer if not already running for this terminal
    if (!this.timers.has(id)) {
      this.timers.set(
        id,
        setTimeout(() => {
          this.timers.delete(id)
          this.flush(id)
        }, this.intervalMs),
      )
    }
  }

  /** Force flush a specific terminal's buffer. */
  flush(id: string): void {
    const arr = this.chunks.get(id)
    const byteLen = this.bufferBytes.get(id) ?? 0
    if (!arr || arr.length === 0) return

    this.chunks.delete(id)
    this.bufferBytes.delete(id)
    const timer = this.timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.timers.delete(id)
    }

    // Single join at flush time — O(n) instead of O(n²) from repeated concat
    const data = arr.length === 1 ? arr[0] : arr.join('')
    this.onFlush(id, data, byteLen)
  }

  /** Force flush all terminal buffers. */
  flushAll(): void {
    // Snapshot keys first — flush may modify the map
    const ids = [...this.chunks.keys()]
    for (const id of ids) {
      this.flush(id)
    }
  }

  /** Remove a terminal's buffer and cancel its timer. */
  remove(id: string): void {
    this.chunks.delete(id)
    this.bufferBytes.delete(id)
    const timer = this.timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.timers.delete(id)
    }
  }

  /** Tear down all timers. */
  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.flushAll()
    this.timers.clear()
  }
}
