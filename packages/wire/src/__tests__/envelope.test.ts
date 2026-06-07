import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeEnvelope, type Envelope, encodeEnvelope, makeEnvelope, PROTOCOL_VERSION } from '../envelope.ts'

describe('envelope', () => {
  describe('encode/decode round-trip', () => {
    it('round-trips a sys envelope', () => {
      const env: Envelope = {
        v: PROTOCOL_VERSION,
        seq: 0,
        ts: 1_700_000_000_000,
        channel: 'sys:ping',
        args: [],
      }
      const result = decodeEnvelope(encodeEnvelope(env))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.envelope).toEqual(env)
    })

    it('round-trips an event envelope with arbitrary args', () => {
      const env = makeEnvelope('event:pod:created', [{ pod: { id: 'p1', name: 'x' } }], {
        seq: 42,
        ts: 1_700_000_000_123,
      })
      const result = decodeEnvelope(encodeEnvelope(env))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.envelope).toEqual(env)
    })

    it('round-trips a terminal control envelope (terminal:* over JSON is allowed)', () => {
      // Binary PTY frames bypass the envelope codec, but some terminal:*
      // control messages (e.g. subscribe acks) still travel as envelopes.
      const env = makeEnvelope('terminal:subscribe', [{ ptyInstanceId: 't1' }])
      const result = decodeEnvelope(encodeEnvelope(env))
      expect(result.ok).toBe(true)
    })
  })

  describe('version handling', () => {
    it('rejects v=2 as unsupported-version', () => {
      const raw = JSON.stringify({ v: 2, seq: 0, ts: 0, channel: 'sys:hello', args: [] })
      const result = decodeEnvelope(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.type).toBe('unsupported-version')
        if (result.error.type === 'unsupported-version') {
          expect(result.error.got).toBe(2)
        }
      }
    })

    it('rejects missing v field via shape validation', () => {
      const raw = JSON.stringify({ seq: 0, ts: 0, channel: 'sys:hello', args: [] })
      const result = decodeEnvelope(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.type).toBe('invalid-shape')
    })

    it('rejects non-numeric v as unsupported-version', () => {
      const raw = JSON.stringify({ v: '1', seq: 0, ts: 0, channel: 'sys:hello', args: [] })
      const result = decodeEnvelope(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.type).toBe('unsupported-version')
    })
  })

  describe('malformed-frame rejection', () => {
    it('rejects non-JSON text', () => {
      const result = decodeEnvelope('not{json')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.type).toBe('invalid-json')
    })

    it('rejects negative seq', () => {
      const raw = JSON.stringify({ v: 1, seq: -1, ts: 0, channel: 'sys:ping', args: [] })
      const result = decodeEnvelope(raw)
      expect(result.ok).toBe(false)
    })

    it('rejects non-integer seq', () => {
      const raw = JSON.stringify({ v: 1, seq: 1.5, ts: 0, channel: 'sys:ping', args: [] })
      const result = decodeEnvelope(raw)
      expect(result.ok).toBe(false)
    })

    it('rejects unknown channel prefix', () => {
      const raw = JSON.stringify({ v: 1, seq: 0, ts: 0, channel: 'random:ping', args: [] })
      const result = decodeEnvelope(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.type).toBe('invalid-shape')
    })

    it('rejects empty channel', () => {
      const raw = JSON.stringify({ v: 1, seq: 0, ts: 0, channel: '', args: [] })
      const result = decodeEnvelope(raw)
      expect(result.ok).toBe(false)
    })

    it('rejects non-array args', () => {
      const raw = JSON.stringify({ v: 1, seq: 0, ts: 0, channel: 'sys:ping', args: 'oops' })
      const result = decodeEnvelope(raw)
      expect(result.ok).toBe(false)
    })

    it('rejects null input', () => {
      const raw = 'null'
      const result = decodeEnvelope(raw)
      expect(result.ok).toBe(false)
    })

    it('rejects array input', () => {
      const raw = '[]'
      const result = decodeEnvelope(raw)
      expect(result.ok).toBe(false)
    })
  })

  describe('property: round-trip preserves value', () => {
    it('round-trips arbitrary valid envelopes', () => {
      fc.assert(
        fc.property(
          fc.record({
            v: fc.constant(PROTOCOL_VERSION),
            seq: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
            ts: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
            channel: fc.oneof(
              fc.string({ minLength: 1, maxLength: 20 }).map((s) => `sys:${s}`),
              fc.string({ minLength: 1, maxLength: 20 }).map((s) => `event:${s}`),
              fc.string({ minLength: 1, maxLength: 20 }).map((s) => `terminal:${s}`),
            ),
            args: fc.array(fc.jsonValue(), { maxLength: 4 }),
          }),
          (env) => {
            const encoded = encodeEnvelope(env as Envelope)
            const decoded = decodeEnvelope(encoded)
            if (!decoded.ok) return false
            // JSON round-trip may introduce structural-equal but reference-
            // different arrays; deep equality is the contract.
            return JSON.stringify(decoded.envelope) === JSON.stringify(env)
          },
        ),
        { numRuns: 200 },
      )
    })
  })

  describe('makeEnvelope', () => {
    it('defaults seq=0 and populates ts', () => {
      const before = Date.now()
      const env = makeEnvelope('sys:ping', [])
      const after = Date.now()
      expect(env.seq).toBe(0)
      expect(env.v).toBe(PROTOCOL_VERSION)
      expect(env.ts).toBeGreaterThanOrEqual(before)
      expect(env.ts).toBeLessThanOrEqual(after)
    })
  })
})
