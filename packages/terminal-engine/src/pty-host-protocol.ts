// ---------------------------------------------------------------------------
// Binary frame protocol for stdio IPC between TerminalEngine and PtyHost.
//
// Frame format: [type: uint8][payloadLength: uint32LE][payload: Buffer]
//
// Uses separate stdin/stdout pipes (unidirectional) instead of Node.js IPC
// (bidirectional socket) to eliminate deadlock risk. Binary framing avoids
// JSON serialization overhead on the hot path.
// ---------------------------------------------------------------------------

import type { Writable } from 'node:stream'

// --- Frame types ---

/** Main process → PtyHost subprocess (via stdin pipe). */
export const HostCmd = {
  Create: 1,
  Write: 2,
  Resize: 3,
  Destroy: 4,
  Ack: 5,
  Subscribe: 6,
  Unsubscribe: 7,
  Scrollback: 8,
  Dispose: 9,
  Clear: 10,
} as const

/** PtyHost subprocess → Main process (via stdout pipe). */
export const HostEvt = {
  Ready: 101,
  Data: 102,
  Exit: 103,
  ScrollbackReply: 104,
} as const

// --- Terminal ID ---

/** UUID string length (e.g. "550e8400-e29b-41d4-a716-446655440000"). */
export const ID_BYTES = 36

// --- Frame header ---

const HEADER_SIZE = 5
const MAX_FRAME_SIZE = 64 * 1024 * 1024 // 64MB safety cap

export function createFrameHeader(type: number, payloadLength: number): Buffer {
  const buf = Buffer.allocUnsafe(HEADER_SIZE)
  buf.writeUInt8(type, 0)
  buf.writeUInt32LE(payloadLength, 1)
  return buf
}

/**
 * Write a framed message to a writable stream. Returns true if the
 * stream can accept more writes, false if the caller should wait for
 * a 'drain' event before writing again.
 */
export function writeFrame(writable: Writable, type: number, payload?: Buffer): boolean {
  const payloadBuf = payload ?? Buffer.alloc(0)
  const header = createFrameHeader(type, payloadBuf.length)
  let canWrite = writable.write(header)
  if (payloadBuf.length > 0) {
    canWrite = writable.write(payloadBuf) && canWrite
  }
  return canWrite
}

// --- Frame decoder ---

interface DecodedFrame {
  type: number
  payload: Buffer
}

/**
 * Stateful binary frame decoder. Handles partial frames split across
 * multiple chunks from a readable stream.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0)
  private state: 'header' | 'payload' | 'skip' = 'header'
  private frameType = 0
  private frameLength = 0
  private skipRemaining = 0

  /**
   * Push a chunk of data and return all complete frames decoded from it.
   * May return 0 frames (partial data) or multiple frames (large chunk).
   */
  push(chunk: Buffer): DecodedFrame[] {
    this.buffer = this.buffer.length > 0 ? Buffer.concat([this.buffer, chunk]) : chunk
    const frames: DecodedFrame[] = []

    while (true) {
      if (this.state === 'skip') {
        if (this.buffer.length === 0) break
        const consumed = Math.min(this.skipRemaining, this.buffer.length)
        this.buffer = this.buffer.subarray(consumed)
        this.skipRemaining -= consumed
        if (this.skipRemaining > 0) break
        this.state = 'header'
        continue
      }

      if (this.state === 'header') {
        if (this.buffer.length < HEADER_SIZE) break
        this.frameType = this.buffer.readUInt8(0)
        this.frameLength = this.buffer.readUInt32LE(1)
        this.buffer = this.buffer.subarray(HEADER_SIZE)
        if (this.frameLength > MAX_FRAME_SIZE) {
          console.error(`[frame-decoder] frame too large: ${this.frameLength} bytes, type=${this.frameType}`)
          this.skipRemaining = this.frameLength
          this.state = 'skip'
          continue
        }
        if (this.frameLength === 0) {
          frames.push({ type: this.frameType, payload: Buffer.alloc(0) })
          // Stay in header state for next frame
          continue
        }
        this.state = 'payload'
      }

      if (this.state === 'payload') {
        if (this.buffer.length < this.frameLength) break
        const payload = this.buffer.subarray(0, this.frameLength)
        this.buffer = this.buffer.subarray(this.frameLength)
        frames.push({ type: this.frameType, payload })
        this.state = 'header'
      }
    }

    return frames
  }
}

// --- Payload builders (hot path — avoid allocations where possible) ---

/** Build a Write/Data payload: [36-byte id][data bytes]. */
export function buildDataPayload(id: string, data: string): Buffer {
  const dataBuf = Buffer.from(data, 'utf-8')
  const payload = Buffer.allocUnsafe(ID_BYTES + dataBuf.length)
  payload.write(id, 0, ID_BYTES, 'ascii')
  dataBuf.copy(payload, ID_BYTES)
  return payload
}

/** Parse a Write/Data payload into id + data string. */
export function parseDataPayload(payload: Buffer): { id: string; data: string } {
  const id = payload.toString('ascii', 0, ID_BYTES)
  const data = payload.toString('utf-8', ID_BYTES)
  return { id, data }
}

/** Build a Resize payload: [36-byte id][cols: uint16LE][rows: uint16LE]. */
export function buildResizePayload(id: string, cols: number, rows: number): Buffer {
  const payload = Buffer.allocUnsafe(ID_BYTES + 4)
  payload.write(id, 0, ID_BYTES, 'ascii')
  payload.writeUInt16LE(cols, ID_BYTES)
  payload.writeUInt16LE(rows, ID_BYTES + 2)
  return payload
}

/** Build an Ack payload: [36-byte id][bytes: uint32LE]. */
export function buildAckPayload(id: string, bytes: number): Buffer {
  const payload = Buffer.allocUnsafe(ID_BYTES + 4)
  payload.write(id, 0, ID_BYTES, 'ascii')
  payload.writeUInt32LE(bytes, ID_BYTES)
  return payload
}

/** Build an ID-only payload: [36-byte id]. */
export function buildIdPayload(id: string): Buffer {
  const payload = Buffer.allocUnsafe(ID_BYTES)
  payload.write(id, 0, ID_BYTES, 'ascii')
  return payload
}

/** Build a Scrollback request payload: [36-byte id][reqId: uint32LE]. */
export function buildScrollbackPayload(id: string, reqId: number): Buffer {
  const payload = Buffer.allocUnsafe(ID_BYTES + 4)
  payload.write(id, 0, ID_BYTES, 'ascii')
  payload.writeUInt32LE(reqId, ID_BYTES)
  return payload
}

/** Build a Scrollback reply payload: [reqId: uint32LE][data bytes]. */
export function buildScrollbackReply(reqId: number, data: string): Buffer {
  const dataBuf = Buffer.from(data, 'utf-8')
  const payload = Buffer.allocUnsafe(4 + dataBuf.length)
  payload.writeUInt32LE(reqId, 0)
  dataBuf.copy(payload, 4)
  return payload
}

/** Build an Exit payload: [36-byte id][code: int32LE]. */
export function buildExitPayload(id: string, code: number): Buffer {
  const payload = Buffer.allocUnsafe(ID_BYTES + 4)
  payload.write(id, 0, ID_BYTES, 'ascii')
  payload.writeInt32LE(code, ID_BYTES)
  return payload
}

// --- Keep JSON types for Create (low frequency, complex payload) ---

import type { PtyConfig } from './types.js'

export interface CreatePayload {
  id: string
  config: PtyConfig
}
