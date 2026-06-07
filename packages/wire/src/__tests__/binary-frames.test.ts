import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  decodeExitPayload,
  decodeFrame,
  decodeResizePayload,
  encodeExitPayload,
  encodeFrame,
  encodeResizePayload,
  FRAME_HEADER_BYTES,
  FrameOpcode,
  MAX_PAYLOAD_BYTES,
} from '../binary-frames.ts'

const te = new TextEncoder()

describe('binary-frames', () => {
  describe('encodeFrame', () => {
    it('writes the fixed 6-byte header then payload', () => {
      const payload = te.encode('hi')
      const frame = encodeFrame(FrameOpcode.OUTPUT, 3, payload)
      expect(frame.byteLength).toBe(FRAME_HEADER_BYTES + payload.byteLength)
      expect(frame[0]).toBe(FrameOpcode.OUTPUT)
      expect(frame[1]).toBe(3)
      // length u32BE
      const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
      expect(view.getUint32(2, false)).toBe(payload.byteLength)
      // payload bytes
      expect(frame.subarray(FRAME_HEADER_BYTES)).toEqual(payload)
    })

    it('rejects unknown opcodes', () => {
      expect(() => encodeFrame(0x99 as unknown as FrameOpcode, 0, new Uint8Array())).toThrow(/unknown opcode/)
    })

    it('rejects out-of-range slots', () => {
      expect(() => encodeFrame(FrameOpcode.OUTPUT, 256, new Uint8Array())).toThrow(/slot/)
      expect(() => encodeFrame(FrameOpcode.OUTPUT, -1, new Uint8Array())).toThrow(/slot/)
    })

    it('rejects oversized payloads at encode time', () => {
      // Synthetic payload whose byteLength exceeds MAX — we don't allocate the
      // full bytes, we just fake a view of the right size via a typed array
      // descriptor. encodeFrame allocates, so allocate only what's needed to
      // trip the check: allocate MAX+1.
      const oversize = new Uint8Array(MAX_PAYLOAD_BYTES + 1)
      expect(() => encodeFrame(FrameOpcode.OUTPUT, 0, oversize)).toThrow(/MAX_PAYLOAD_BYTES/)
    })
  })

  describe('decodeFrame', () => {
    it('round-trips an OUTPUT frame', () => {
      const payload = te.encode('hello world')
      const encoded = encodeFrame(FrameOpcode.OUTPUT, 7, payload)
      const result = decodeFrame(encoded)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.frame.opcode).toBe(FrameOpcode.OUTPUT)
        expect(result.frame.slot).toBe(7)
        expect(Array.from(result.frame.payload)).toEqual(Array.from(payload))
        expect(result.bytesConsumed).toBe(encoded.byteLength)
      }
    })

    it('returns too-short for empty buffer', () => {
      const result = decodeFrame(new Uint8Array(0))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.type).toBe('too-short')
    })

    it('returns too-short for partial header', () => {
      const result = decodeFrame(new Uint8Array([0x01, 0x02]))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.type).toBe('too-short')
    })

    it('returns unknown-opcode for opcode outside the enum', () => {
      const buf = new Uint8Array(FRAME_HEADER_BYTES)
      buf[0] = 0x99
      // length = 0
      const result = decodeFrame(buf)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.type).toBe('unknown-opcode')
        if (result.error.type === 'unknown-opcode') expect(result.error.opcode).toBe(0x99)
      }
    })

    it('returns truncated when declared length exceeds available bytes', () => {
      // declared length 100, supply only header
      const buf = new Uint8Array(FRAME_HEADER_BYTES)
      buf[0] = FrameOpcode.OUTPUT
      buf[1] = 0
      new DataView(buf.buffer).setUint32(2, 100, false)
      const result = decodeFrame(buf)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.type).toBe('truncated')
        if (result.error.type === 'truncated') {
          expect(result.error.declared).toBe(100)
          expect(result.error.available).toBe(FRAME_HEADER_BYTES)
        }
      }
    })

    it('returns length-exceeds-max when declared length > MAX_PAYLOAD_BYTES', () => {
      const buf = new Uint8Array(FRAME_HEADER_BYTES)
      buf[0] = FrameOpcode.OUTPUT
      buf[1] = 0
      new DataView(buf.buffer).setUint32(2, MAX_PAYLOAD_BYTES + 1, false)
      const result = decodeFrame(buf)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.type).toBe('length-exceeds-max')
    })

    it('decodes at a non-zero offset', () => {
      const junk = te.encode('JUNK')
      const payload = te.encode('hi')
      const frame = encodeFrame(FrameOpcode.INPUT, 1, payload)
      const combined = new Uint8Array(junk.byteLength + frame.byteLength)
      combined.set(junk, 0)
      combined.set(frame, junk.byteLength)
      const result = decodeFrame(combined, junk.byteLength)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.frame.opcode).toBe(FrameOpcode.INPUT)
        expect(Array.from(result.frame.payload)).toEqual(Array.from(payload))
        expect(result.bytesConsumed).toBe(frame.byteLength)
      }
    })

    it('supports back-to-back decode of concatenated frames', () => {
      const a = encodeFrame(FrameOpcode.OUTPUT, 1, te.encode('aa'))
      const b = encodeFrame(FrameOpcode.OUTPUT, 2, te.encode('bbb'))
      const merged = new Uint8Array(a.byteLength + b.byteLength)
      merged.set(a, 0)
      merged.set(b, a.byteLength)

      const r1 = decodeFrame(merged, 0)
      expect(r1.ok).toBe(true)
      if (!r1.ok) return
      expect(r1.frame.slot).toBe(1)

      const r2 = decodeFrame(merged, r1.bytesConsumed)
      expect(r2.ok).toBe(true)
      if (!r2.ok) return
      expect(r2.frame.slot).toBe(2)
      expect(Array.from(r2.frame.payload)).toEqual(Array.from(te.encode('bbb')))
    })
  })

  describe('resize payload', () => {
    it('round-trips cols/rows', () => {
      const p = encodeResizePayload(80, 24)
      expect(p.byteLength).toBe(4)
      expect(decodeResizePayload(p)).toEqual({ cols: 80, rows: 24 })
    })

    it('rejects out-of-range values', () => {
      expect(() => encodeResizePayload(-1, 24)).toThrow()
      expect(() => encodeResizePayload(80, 65_536)).toThrow()
    })

    it('rejects wrong-size payload on decode', () => {
      expect(() => decodeResizePayload(new Uint8Array(3))).toThrow(/4 bytes/)
    })
  })

  describe('exit payload', () => {
    it('round-trips exit codes', () => {
      const p = encodeExitPayload(137)
      expect(p.byteLength).toBe(4)
      expect(decodeExitPayload(p)).toBe(137)
    })

    it('supports u32 range', () => {
      const p = encodeExitPayload(0xffff_ffff)
      expect(decodeExitPayload(p)).toBe(0xffff_ffff)
    })

    it('rejects negatives and non-integers', () => {
      expect(() => encodeExitPayload(-1)).toThrow()
      expect(() => encodeExitPayload(1.5)).toThrow()
      expect(() => encodeExitPayload(0x1_0000_0000)).toThrow()
    })
  })

  describe('property: frame round-trips preserve bytes + header', () => {
    it('encodes and decodes arbitrary (opcode, slot, payload)', () => {
      const opcodes = Object.values(FrameOpcode)
      fc.assert(
        fc.property(
          fc.constantFrom(...opcodes),
          fc.integer({ min: 0, max: 255 }),
          fc.uint8Array({ maxLength: 1024 }),
          (opcode, slot, payload) => {
            const encoded = encodeFrame(opcode, slot, payload)
            const result = decodeFrame(encoded)
            if (!result.ok) return false
            if (result.frame.opcode !== opcode) return false
            if (result.frame.slot !== slot) return false
            if (result.bytesConsumed !== encoded.byteLength) return false
            return (
              result.frame.payload.byteLength === payload.byteLength &&
              result.frame.payload.every((b, i) => b === payload[i])
            )
          },
        ),
        { numRuns: 200 },
      )
    })
  })
})
