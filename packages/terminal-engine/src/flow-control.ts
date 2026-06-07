// ---------------------------------------------------------------------------
// Watermark-based flow control for PTY output.
//
// Modeled on VS Code's FlowControlConstants:
//   - HighWatermarkChars = 100_000  (pause PTY)
//   - LowWatermarkChars  = 5_000   (resume PTY after ack)
//   - CharCountAckSize   = 5_000   (client acks every 5KB)
//
// The engine increments `unackedBytes` when it sends data to the client.
// The client sends ack messages as it processes data. When unacked bytes
// cross the high watermark, we pause the underlying node-pty stream.
// When an ack brings it below the low watermark, we resume.
// ---------------------------------------------------------------------------

const DEFAULT_HIGH_WATERMARK = 100_000
const DEFAULT_LOW_WATERMARK = 5_000

export interface FlowControlOptions {
  highWaterMark?: number
  lowWaterMark?: number
}

export interface FlowControlCallbacks {
  pause: () => void
  resume: () => void
}

export class FlowController {
  private unackedBytes = 0
  private _paused = false
  private _pauseCount = 0
  private readonly highWaterMark: number
  private readonly lowWaterMark: number
  private readonly callbacks: FlowControlCallbacks

  constructor(callbacks: FlowControlCallbacks, opts?: FlowControlOptions) {
    this.callbacks = callbacks
    this.highWaterMark = opts?.highWaterMark ?? DEFAULT_HIGH_WATERMARK
    this.lowWaterMark = opts?.lowWaterMark ?? DEFAULT_LOW_WATERMARK
  }

  /** Called when data is sent to the client. Returns true if PTY should be paused. */
  sent(bytes: number): boolean {
    this.unackedBytes += bytes
    if (!this._paused && this.unackedBytes > this.highWaterMark) {
      this._paused = true
      this._pauseCount++
      this.callbacks.pause()
    }
    return this._paused
  }

  /** Called when the client acknowledges processing N bytes. */
  ack(bytes: number): void {
    this.unackedBytes = Math.max(0, this.unackedBytes - bytes)
    if (this._paused && this.unackedBytes < this.lowWaterMark) {
      this._paused = false
      this.callbacks.resume()
    }
  }

  get paused(): boolean {
    return this._paused
  }

  get pauseCount(): number {
    return this._pauseCount
  }

  get pending(): number {
    return this.unackedBytes
  }

  reset(): void {
    this.unackedBytes = 0
    if (this._paused) {
      this._paused = false
      this.callbacks.resume()
    }
  }
}
