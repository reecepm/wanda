// ---------------------------------------------------------------------------
// Stream verifier — parses generator output and checks correctness.
//
// Handles:
// - Line reassembly (data arrives in arbitrary chunks from batching)
// - Sequence ordering validation
// - CRC32 integrity checking
// - Gap/drop detection
// - Duplicate detection
// - Cross-terminal contamination detection (wrong prefix)
// ---------------------------------------------------------------------------

import { crc32 } from 'node:zlib'

export interface VerifyResult {
  terminalId: string
  totalLines: number
  orderingViolations: number
  crcFailures: number
  drops: number
  duplicates: number
  contamination: number // lines from wrong terminal
  elapsedMs: number
  bytesReceived: number
  throughputMBps: number
  linesPerSecond: number
  done: boolean // received BENCH_DONE sentinel
}

export class StreamVerifier {
  readonly terminalId: string
  private expectedPrefix: string
  private buffer = ''
  private lastSeq = 0
  private seenSeqs = new Set<number>()
  private startTime = 0
  private bytesReceived = 0

  // Counters
  totalLines = 0
  orderingViolations = 0
  crcFailures = 0
  drops = 0
  duplicates = 0
  contamination = 0
  done = false
  doneLines = 0
  doneBytes = 0

  constructor(terminalId: string, expectedPrefix?: string) {
    this.terminalId = terminalId
    this.expectedPrefix = expectedPrefix ?? terminalId
  }

  /** Feed raw data from the terminal. Call this with every data chunk. */
  feed(data: string): void {
    if (this.startTime === 0) this.startTime = Date.now()
    this.bytesReceived += data.length
    this.buffer += data

    // Process complete lines
    let newlineIdx: number
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      // Strip trailing \r (PTY converts \n → \r\n)
      let lineEnd = newlineIdx
      if (lineEnd > 0 && this.buffer[lineEnd - 1] === '\r') lineEnd--
      const line = this.buffer.slice(0, lineEnd)
      this.buffer = this.buffer.slice(newlineIdx + 1)
      if (line.length > 0) this.processLine(line)
    }
  }

  private processLine(line: string): void {
    // Check for BENCH_DONE sentinel
    if (line.startsWith('BENCH_DONE:')) {
      const parts = line.split(':')
      this.doneLines = parseInt(parts[1], 10)
      this.doneBytes = parseInt(parts[2], 10)
      this.done = true
      return
    }

    // Expected format: SEQ:00000001:payload:CRC32HEX
    if (!line.startsWith('SEQ:')) return // Skip non-generator output (e.g. shell prompt)

    this.totalLines++

    // Split from the end to find the CRC (last 8 chars after last colon)
    const lastColon = line.lastIndexOf(':')
    if (lastColon === -1 || lastColon === line.length - 1) {
      this.crcFailures++
      return
    }

    const body = line.slice(0, lastColon)
    const receivedCrc = line.slice(lastColon + 1)

    // Validate CRC32
    const expectedCrc = crc32(Buffer.from(body)).toString(16).padStart(8, '0')
    if (receivedCrc !== expectedCrc) {
      this.crcFailures++
      return
    }

    // Extract sequence number: SEQ:00000001:...
    const seqEnd = body.indexOf(':', 4) // skip 'SEQ:'
    if (seqEnd === -1) {
      this.crcFailures++
      return
    }
    const seqStr = body.slice(4, seqEnd)
    const seq = parseInt(seqStr, 10)
    if (isNaN(seq)) {
      this.crcFailures++
      return
    }

    // Check for correct prefix in payload
    const payload = body.slice(seqEnd + 1)
    if (!payload.startsWith(this.expectedPrefix + ':')) {
      this.contamination++
      return
    }

    // Check ordering
    if (seq <= this.lastSeq) {
      if (this.seenSeqs.has(seq)) {
        this.duplicates++
      } else {
        this.orderingViolations++
      }
    } else {
      // Check for gaps
      if (seq > this.lastSeq + 1) {
        this.drops += seq - this.lastSeq - 1
      }
      this.lastSeq = seq
    }

    this.seenSeqs.add(seq)
  }

  /** Get the current verification result. */
  getResult(): VerifyResult {
    const elapsed = this.startTime > 0 ? Date.now() - this.startTime : 0
    return {
      terminalId: this.terminalId,
      totalLines: this.totalLines,
      orderingViolations: this.orderingViolations,
      crcFailures: this.crcFailures,
      drops: this.drops,
      duplicates: this.duplicates,
      contamination: this.contamination,
      elapsedMs: elapsed,
      bytesReceived: this.bytesReceived,
      throughputMBps: elapsed > 0 ? this.bytesReceived / elapsed / 1000 : 0,
      linesPerSecond: elapsed > 0 ? (this.totalLines / elapsed) * 1000 : 0,
      done: this.done,
    }
  }

  /** Check if the result passes all correctness assertions. */
  passes(): boolean {
    return (
      this.orderingViolations === 0 &&
      this.crcFailures === 0 &&
      this.drops === 0 &&
      this.duplicates === 0 &&
      this.contamination === 0
    )
  }

  /** Reset state for a new run. */
  reset(): void {
    this.buffer = ''
    this.lastSeq = 0
    this.seenSeqs.clear()
    this.startTime = 0
    this.bytesReceived = 0
    this.totalLines = 0
    this.orderingViolations = 0
    this.crcFailures = 0
    this.drops = 0
    this.duplicates = 0
    this.contamination = 0
    this.done = false
    this.doneLines = 0
    this.doneBytes = 0
  }
}

// ---------------------------------------------------------------------------
// InputEchoVerifier — verifies echoed input lines from concurrent-worker.
//
// Expects lines prefixed with "ECHO:" followed by the original input.
// The original input format is: INP:seqnum:payload
// Checks that echoed input arrives in the same order it was sent.
// ---------------------------------------------------------------------------

export interface InputVerifyResult {
  totalEchoed: number
  orderingViolations: number
  missing: number
  latencies: number[] // per-line roundtrip latency in ms
}

export class InputEchoVerifier {
  private buffer = ''
  private lastSeq = 0
  private expectedTotal = 0
  private sendTimestamps = new Map<number, number>()

  totalEchoed = 0
  orderingViolations = 0
  missing = 0
  latencies: number[] = []

  /** Record when a line was sent (for latency measurement). */
  recordSend(seq: number): void {
    this.sendTimestamps.set(seq, performance.now())
  }

  setExpectedTotal(n: number): void {
    this.expectedTotal = n
  }

  /** Feed raw data from the terminal. Filters for ECHO: prefixed lines. */
  feed(data: string): void {
    this.buffer += data

    let newlineIdx: number
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      let lineEnd = newlineIdx
      if (lineEnd > 0 && this.buffer[lineEnd - 1] === '\r') lineEnd--
      const line = this.buffer.slice(0, lineEnd)
      this.buffer = this.buffer.slice(newlineIdx + 1)
      if (line.startsWith('ECHO:')) this.processEcho(line)
    }
  }

  private processEcho(line: string): void {
    // Format: ECHO:INP:00000001:payload
    const inner = line.slice(5) // strip "ECHO:"
    if (!inner.startsWith('INP:')) return

    this.totalEchoed++

    // Extract sequence number: INP:00000001:...
    const seqEnd = inner.indexOf(':', 4)
    if (seqEnd === -1) return
    const seq = parseInt(inner.slice(4, seqEnd), 10)
    if (isNaN(seq)) return

    // Check ordering
    if (seq <= this.lastSeq) {
      this.orderingViolations++
    } else {
      if (seq > this.lastSeq + 1) {
        this.missing += seq - this.lastSeq - 1
      }
      this.lastSeq = seq
    }

    // Measure latency
    const sendTime = this.sendTimestamps.get(seq)
    if (sendTime !== undefined) {
      this.latencies.push(performance.now() - sendTime)
      this.sendTimestamps.delete(seq)
    }
  }

  get allReceived(): boolean {
    return this.expectedTotal > 0 && this.totalEchoed >= this.expectedTotal
  }

  getResult(): InputVerifyResult {
    return {
      totalEchoed: this.totalEchoed,
      orderingViolations: this.orderingViolations,
      missing: this.missing,
      latencies: [...this.latencies],
    }
  }

  passes(): boolean {
    return this.orderingViolations === 0 && this.missing === 0
  }
}
