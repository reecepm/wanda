import { describe, expect, it } from 'vitest'
import { HELLO_REJECTED_REASONS, HelloAckSchema, HelloRejectedSchema, HelloSchema } from '../contracts/hello.ts'
import { PROTOCOL_VERSION } from '../envelope.ts'

describe('hello', () => {
  describe('HelloSchema', () => {
    it('accepts a fresh-session hello (no sessionId)', () => {
      const msg = { v: PROTOCOL_VERSION, clientId: 'client-abc' }
      expect(HelloSchema.safeParse(msg).success).toBe(true)
    })

    it('accepts a resume hello', () => {
      const msg = {
        v: PROTOCOL_VERSION,
        clientId: 'client-abc',
        sessionId: 'sess-xyz',
        resumeFromSeq: 42,
        epoch: 3,
      }
      expect(HelloSchema.safeParse(msg).success).toBe(true)
    })

    it('rejects missing clientId', () => {
      const msg = { v: PROTOCOL_VERSION }
      expect(HelloSchema.safeParse(msg).success).toBe(false)
    })

    it('rejects empty clientId', () => {
      const msg = { v: PROTOCOL_VERSION, clientId: '' }
      expect(HelloSchema.safeParse(msg).success).toBe(false)
    })

    it('rejects wrong version', () => {
      const msg = { v: 2, clientId: 'c' }
      expect(HelloSchema.safeParse(msg).success).toBe(false)
    })

    it('rejects negative resumeFromSeq', () => {
      const msg = { v: PROTOCOL_VERSION, clientId: 'c', resumeFromSeq: -1 }
      expect(HelloSchema.safeParse(msg).success).toBe(false)
    })

    it('rejects epoch=0 (first epoch is 1)', () => {
      const msg = { v: PROTOCOL_VERSION, clientId: 'c', epoch: 0 }
      expect(HelloSchema.safeParse(msg).success).toBe(false)
    })
  })

  describe('HelloAckSchema', () => {
    it('accepts a valid ack', () => {
      const msg = {
        serverId: 'srv-1',
        serverSeq: 100,
        epoch: 2,
        protocolSupported: [1],
      }
      expect(HelloAckSchema.safeParse(msg).success).toBe(true)
    })

    it('rejects empty protocolSupported', () => {
      const msg = { serverId: 's', serverSeq: 0, epoch: 1, protocolSupported: [] }
      expect(HelloAckSchema.safeParse(msg).success).toBe(false)
    })

    it('rejects missing serverId', () => {
      const msg = { serverSeq: 0, epoch: 1, protocolSupported: [1] }
      expect(HelloAckSchema.safeParse(msg).success).toBe(false)
    })
  })

  describe('HelloRejectedSchema', () => {
    it('accepts every defined reason', () => {
      for (const reason of HELLO_REJECTED_REASONS) {
        expect(HelloRejectedSchema.safeParse({ reason }).success).toBe(true)
      }
    })

    it('rejects unknown reasons', () => {
      expect(HelloRejectedSchema.safeParse({ reason: 'meh' }).success).toBe(false)
    })
  })
})
