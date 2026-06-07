// ---------------------------------------------------------------------------
// Metrics collector — throughput, latency percentiles, flow control stats.
// ---------------------------------------------------------------------------

export interface MetricsSnapshot {
  /** Elapsed time in ms since metrics started. */
  elapsedMs: number
  /** Per-terminal metrics. */
  terminals: Map<
    string,
    {
      bytesPerSec: number
      linesPerSec: number
      totalBytes: number
      totalLines: number
      paused: boolean
      pauseCount: number
    }
  >
  /** Aggregate throughput. */
  aggregateBytesPerSec: number
  aggregateLinesPerSec: number
}

interface TerminalCounter {
  bytesWindow: number[]
  linesWindow: number[]
  totalBytes: number
  totalLines: number
  paused: boolean
  pauseCount: number
}

const WINDOW_SIZE = 10 // 10 slots for 1-second windowed averaging

export class MetricsCollector {
  private counters = new Map<string, TerminalCounter>()
  private startTime = Date.now()
  private windowSlot = 0
  private tickTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Rotate window every 100ms for smooth averaging
    this.tickTimer = setInterval(() => this.tick(), 100)
  }

  /** Register a terminal for metrics tracking. */
  register(id: string): void {
    this.counters.set(id, {
      bytesWindow: new Array(WINDOW_SIZE).fill(0),
      linesWindow: new Array(WINDOW_SIZE).fill(0),
      totalBytes: 0,
      totalLines: 0,
      paused: false,
      pauseCount: 0,
    })
  }

  /** Record bytes received for a terminal. */
  recordBytes(id: string, bytes: number): void {
    const c = this.counters.get(id)
    if (!c) return
    c.bytesWindow[this.windowSlot] += bytes
    c.totalBytes += bytes
  }

  /** Record lines received for a terminal. */
  recordLines(id: string, lines: number): void {
    const c = this.counters.get(id)
    if (!c) return
    c.linesWindow[this.windowSlot] += lines
    c.totalLines += lines
  }

  /** Update flow control state for a terminal. */
  setFlowState(id: string, paused: boolean, pauseCount: number): void {
    const c = this.counters.get(id)
    if (!c) return
    c.paused = paused
    c.pauseCount = pauseCount
  }

  /** Remove a terminal from tracking. */
  remove(id: string): void {
    this.counters.delete(id)
  }

  private tick(): void {
    this.windowSlot = (this.windowSlot + 1) % WINDOW_SIZE
    // Clear the next slot to prepare for new data
    for (const c of this.counters.values()) {
      c.bytesWindow[this.windowSlot] = 0
      c.linesWindow[this.windowSlot] = 0
    }
  }

  /** Get a snapshot of current metrics. */
  snapshot(): MetricsSnapshot {
    const terminals = new Map<string, MetricsSnapshot['terminals'] extends Map<string, infer V> ? V : never>()
    let aggBytes = 0
    let aggLines = 0

    for (const [id, c] of this.counters) {
      const bytesSum = c.bytesWindow.reduce((a, b) => a + b, 0)
      const linesSum = c.linesWindow.reduce((a, b) => a + b, 0)
      // Window covers WINDOW_SIZE * 100ms = 1 second
      const bytesPerSec = bytesSum
      const linesPerSec = linesSum

      terminals.set(id, {
        bytesPerSec,
        linesPerSec,
        totalBytes: c.totalBytes,
        totalLines: c.totalLines,
        paused: c.paused,
        pauseCount: c.pauseCount,
      })

      aggBytes += bytesPerSec
      aggLines += linesPerSec
    }

    return {
      elapsedMs: Date.now() - this.startTime,
      terminals,
      aggregateBytesPerSec: aggBytes,
      aggregateLinesPerSec: aggLines,
    }
  }

  dispose(): void {
    if (this.tickTimer) clearInterval(this.tickTimer)
  }
}

/** Compute percentile from a sorted array of numbers. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}
