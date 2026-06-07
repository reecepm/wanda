// -----------------------------------------------------------------------------
// Binary opcode frame codec for PTY traffic ONLY.
//
// Frame format (big-endian for length):
//   [opcode:u8][slot:u8][len:u32BE][payload:bytes]
//
// Opcodes:
//   0x01 OUTPUT   server→client: raw PTY bytes
//   0x02 INPUT    client→server: bytes to write to the PTY
//   0x03 RESIZE   client→server: [cols:u16BE][rows:u16BE]
//   0x04 SNAPSHOT server→client: opaque snapshot blob from terminal-engine
//   0x05 EXIT     server→client: [code:u32BE]
//
// Slot is a per-session, per-ptyInstance multiplex id allocated by the server
// (see spec §4.6 — session-scoped slot allocation). The codec treats slot as
// an opaque u8.
// -----------------------------------------------------------------------------

export const FrameOpcode = {
  OUTPUT: 0x01,
  INPUT: 0x02,
  RESIZE: 0x03,
  SNAPSHOT: 0x04,
  EXIT: 0x05,
} as const

export type FrameOpcode = (typeof FrameOpcode)[keyof typeof FrameOpcode]

const KNOWN_OPCODES = new Set<number>(Object.values(FrameOpcode))

export const FRAME_HEADER_BYTES = 6
/**
 * Maximum payload size the codec will decode. 16 MiB is comfortably above
 * the largest realistic snapshot and below any sensible WS transport limit.
 * Frames larger than this are rejected as malformed to bound DoS surface.
 */
export const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024

export interface Frame {
  readonly opcode: FrameOpcode
  readonly slot: number
  readonly payload: Uint8Array
}

export type FrameDecodeError =
  | { readonly type: 'too-short' }
  | { readonly type: 'unknown-opcode'; readonly opcode: number }
  | { readonly type: 'length-exceeds-max'; readonly length: number }
  | { readonly type: 'truncated'; readonly declared: number; readonly available: number }

export type FrameDecodeResult =
  | { readonly ok: true; readonly frame: Frame; readonly bytesConsumed: number }
  | { readonly ok: false; readonly error: FrameDecodeError }

// --- Single-frame encode/decode -----------------------------------------------

export function encodeFrame(opcode: FrameOpcode, slot: number, payload: Uint8Array): Uint8Array {
  if (!KNOWN_OPCODES.has(opcode)) {
    throw new Error(`encodeFrame: unknown opcode ${opcode}`)
  }
  if (!Number.isInteger(slot) || slot < 0 || slot > 0xff) {
    throw new Error(`encodeFrame: slot out of range (${slot}); must be u8`)
  }
  if (payload.byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error(`encodeFrame: payload size ${payload.byteLength} exceeds MAX_PAYLOAD_BYTES (${MAX_PAYLOAD_BYTES})`)
  }

  const out = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  view.setUint8(0, opcode)
  view.setUint8(1, slot)
  view.setUint32(2, payload.byteLength, false) // big-endian
  out.set(payload, FRAME_HEADER_BYTES)
  return out
}

/**
 * Decode a single frame starting at `offset` in `bytes`. Returns the frame and
 * the number of bytes consumed. The payload is a view into the source buffer —
 * callers that retain it beyond the lifetime of the source should copy.
 */
export function decodeFrame(bytes: Uint8Array, offset = 0): FrameDecodeResult {
  const available = bytes.byteLength - offset
  if (available < FRAME_HEADER_BYTES) {
    return { ok: false, error: { type: 'too-short' } }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, available)
  const opcode = view.getUint8(0)
  const slot = view.getUint8(1)
  const length = view.getUint32(2, false)

  if (!KNOWN_OPCODES.has(opcode)) {
    return { ok: false, error: { type: 'unknown-opcode', opcode } }
  }
  if (length > MAX_PAYLOAD_BYTES) {
    return { ok: false, error: { type: 'length-exceeds-max', length } }
  }

  const frameTotal = FRAME_HEADER_BYTES + length
  if (available < frameTotal) {
    return { ok: false, error: { type: 'truncated', declared: length, available } }
  }

  const payload = bytes.subarray(offset + FRAME_HEADER_BYTES, offset + frameTotal)

  return {
    ok: true,
    frame: { opcode: opcode as FrameOpcode, slot, payload },
    bytesConsumed: frameTotal,
  }
}

// --- Typed payload helpers ---------------------------------------------------

export function encodeResizePayload(cols: number, rows: number): Uint8Array {
  if (!Number.isInteger(cols) || cols < 0 || cols > 0xffff) {
    throw new Error(`encodeResizePayload: cols out of range (${cols}); must be u16`)
  }
  if (!Number.isInteger(rows) || rows < 0 || rows > 0xffff) {
    throw new Error(`encodeResizePayload: rows out of range (${rows}); must be u16`)
  }
  const out = new Uint8Array(4)
  const view = new DataView(out.buffer)
  view.setUint16(0, cols, false)
  view.setUint16(2, rows, false)
  return out
}

export function decodeResizePayload(payload: Uint8Array): { cols: number; rows: number } {
  if (payload.byteLength !== 4) {
    throw new Error(`decodeResizePayload: expected 4 bytes, got ${payload.byteLength}`)
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return { cols: view.getUint16(0, false), rows: view.getUint16(2, false) }
}

export function encodeExitPayload(code: number): Uint8Array {
  // Exit codes should be integers in [0, 0xffff_ffff]. POSIX exit codes are
  // 8-bit but we carry a full u32 so signal-termination sentinels still fit.
  if (!Number.isInteger(code) || code < 0 || code > 0xffff_ffff) {
    throw new Error(`encodeExitPayload: code out of range (${code}); must be u32`)
  }
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, code, false)
  return out
}

export function decodeExitPayload(payload: Uint8Array): number {
  if (payload.byteLength !== 4) {
    throw new Error(`decodeExitPayload: expected 4 bytes, got ${payload.byteLength}`)
  }
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, false)
}
