import { describe, expect, it } from 'vitest'
import { createFrameHeader, FrameDecoder, HostCmd } from '../src/pty-host-protocol.js'

function frame(type: number, payload: Buffer): Buffer {
  return Buffer.concat([createFrameHeader(type, payload.length), payload])
}

describe('FrameDecoder', () => {
  it('decodes a single complete frame', () => {
    const decoder = new FrameDecoder()
    const payload = Buffer.from('hello world', 'utf-8')
    const frames = decoder.push(frame(HostCmd.Write, payload))
    expect(frames).toHaveLength(1)
    expect(frames[0].type).toBe(HostCmd.Write)
    expect(frames[0].payload.equals(payload)).toBe(true)
  })

  it('decodes a zero-length payload frame', () => {
    const decoder = new FrameDecoder()
    const frames = decoder.push(createFrameHeader(HostCmd.Ack, 0))
    expect(frames).toHaveLength(1)
    expect(frames[0].type).toBe(HostCmd.Ack)
    expect(frames[0].payload.length).toBe(0)
  })

  it('decodes multiple frames from one chunk', () => {
    const decoder = new FrameDecoder()
    const a = Buffer.from('first', 'utf-8')
    const b = Buffer.from('second payload', 'utf-8')
    const frames = decoder.push(Buffer.concat([frame(HostCmd.Write, a), frame(HostCmd.Resize, b)]))
    expect(frames.map((f) => f.type)).toEqual([HostCmd.Write, HostCmd.Resize])
    expect(frames[0].payload.equals(a)).toBe(true)
    expect(frames[1].payload.equals(b)).toBe(true)
  })

  it('reassembles a frame split across chunks', () => {
    const decoder = new FrameDecoder()
    const payload = Buffer.from('split across chunks', 'utf-8')
    const wire = frame(HostCmd.Write, payload)

    expect(decoder.push(wire.subarray(0, 3))).toHaveLength(0)
    expect(decoder.push(wire.subarray(3, 8))).toHaveLength(0)
    const frames = decoder.push(wire.subarray(8))
    expect(frames).toHaveLength(1)
    expect(frames[0].payload.equals(payload)).toBe(true)
  })

  it('reassembles a frame fed one byte at a time', () => {
    const decoder = new FrameDecoder()
    const payload = Buffer.from('byte by byte', 'utf-8')
    const wire = frame(HostCmd.Write, payload)

    const collected = []
    for (const byte of wire) {
      collected.push(...decoder.push(Buffer.from([byte])))
    }
    expect(collected).toHaveLength(1)
    expect(collected[0].payload.equals(payload)).toBe(true)
  })

  it('skips an oversized frame and resynchronizes on the next valid frame', () => {
    const decoder = new FrameDecoder()
    const oversized = 128 * 1024 * 1024 // > MAX_FRAME_SIZE (64MB)
    const next = Buffer.from('recovered', 'utf-8')

    // Oversized header followed by a small slice of its bogus payload, then a valid frame.
    const garbage = Buffer.alloc(1024, 0xff)
    const first = decoder.push(Buffer.concat([createFrameHeader(HostCmd.Write, oversized), garbage]))
    expect(first).toHaveLength(0)

    // Drain the remainder of the bogus payload across multiple chunks, then a real frame.
    let recovered: ReturnType<FrameDecoder['push']> = []
    let drained = garbage.length
    while (drained < oversized) {
      const step = Math.min(1024 * 1024, oversized - drained)
      recovered = decoder.push(Buffer.alloc(step, 0xff))
      drained += step
      expect(recovered).toHaveLength(0)
    }
    recovered = decoder.push(frame(HostCmd.Resize, next))
    expect(recovered).toHaveLength(1)
    expect(recovered[0].type).toBe(HostCmd.Resize)
    expect(recovered[0].payload.equals(next)).toBe(true)
  })

  it('does not buffer the full oversized payload while skipping', () => {
    const decoder = new FrameDecoder()
    const oversized = 1024 * 1024 * 1024 // 1GB declared length
    decoder.push(createFrameHeader(HostCmd.Write, oversized))

    // Feed a bounded amount of garbage; the decoder must consume it without
    // retaining a buffer anywhere near the declared length.
    for (let i = 0; i < 16; i++) {
      decoder.push(Buffer.alloc(4 * 1024 * 1024, 0xff))
    }
    const internalBuffer = (decoder as unknown as { buffer: Buffer }).buffer
    expect(internalBuffer.length).toBeLessThan(1024 * 1024)
  })

  it('skips a corrupt-length frame straddling a chunk boundary', () => {
    const decoder = new FrameDecoder()
    const oversized = 100 * 1024 * 1024
    const header = createFrameHeader(HostCmd.Write, oversized)

    // Header itself split across chunks, then a partial skip, then resync.
    expect(decoder.push(header.subarray(0, 2))).toHaveLength(0)
    expect(decoder.push(header.subarray(2))).toHaveLength(0)

    let drained = 0
    while (drained < oversized) {
      const step = Math.min(8 * 1024 * 1024, oversized - drained)
      decoder.push(Buffer.alloc(step, 0xff))
      drained += step
    }
    const good = Buffer.from('ok', 'utf-8')
    const frames = decoder.push(frame(HostCmd.Destroy, good))
    expect(frames).toHaveLength(1)
    expect(frames[0].type).toBe(HostCmd.Destroy)
    expect(frames[0].payload.equals(good)).toBe(true)
  })
})
