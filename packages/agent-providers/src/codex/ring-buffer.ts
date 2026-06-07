// -----------------------------------------------------------------------------
// Byte-counted FIFO ring buffer for subprocess stderr capture.
// -----------------------------------------------------------------------------

export class RingBuffer {
  private chunks: Buffer[] = []
  private size = 0
  private readonly capacityBytes: number

  constructor(capacityBytes: number) {
    this.capacityBytes = capacityBytes
  }

  append(chunk: Buffer): void {
    this.chunks.push(chunk)
    this.size += chunk.length
    while (this.size > this.capacityBytes && this.chunks.length > 0) {
      const dropped = this.chunks.shift()!
      this.size -= dropped.length
    }
  }

  snapshot(): string {
    return Buffer.concat(this.chunks).toString('utf8')
  }

  get byteLength(): number {
    return this.size
  }
}
