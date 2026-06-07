#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Benchmark data generator — runs INSIDE a PTY spawned by the engine.
//
// Outputs sequenced, CRC32-checksummed lines at maximum throughput.
// Each line: SEQ:000001:CRC32HEX:payload_data\n
//
// The verifier on the receiving end parses these lines to detect:
// - Ordering violations (sequence numbers out of order)
// - Data corruption (CRC32 mismatch)
// - Dropped lines (sequence gaps)
// - Duplicates
//
// Usage: node generator.js [--lines N] [--payload-size N] [--duration-ms N] [--prefix ID]
// ---------------------------------------------------------------------------

import { crc32 } from 'node:zlib'

const args = process.argv.slice(2)
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal
}

const totalLines = parseInt(getArg('lines', '0'), 10) // 0 = use duration
const payloadSize = parseInt(getArg('payload-size', '200'), 10)
const durationMs = parseInt(getArg('duration-ms', '10000'), 10)
const prefix = getArg('prefix', 'T0')

// Generate a deterministic payload based on sequence number
function makePayload(seq: number, size: number): string {
  const base = `${prefix}:${seq.toString(36)}:`
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let payload = base
  let i = 0
  while (payload.length < size) {
    payload += chars[(seq * 7 + i * 13) % chars.length]
    i++
  }
  return payload.slice(0, size)
}

function computeCrc(data: string): string {
  return crc32(Buffer.from(data)).toString(16).padStart(8, '0')
}

let seq = 0
let totalBytes = 0
const startTime = Date.now()

function writeBatch(): void {
  let chunk = ''
  const batchSize = 100 // Write 100 lines at a time to reduce syscalls

  for (let i = 0; i < batchSize; i++) {
    seq++

    // Check termination conditions
    if (totalLines > 0 && seq > totalLines) {
      // Flush remaining + done sentinel
      if (chunk) process.stdout.write(chunk)
      process.stdout.write(`BENCH_DONE:${seq - 1}:${totalBytes + chunk.length}\n`, () => {
        process.exit(0)
      })
      return
    }

    const payload = makePayload(seq, payloadSize)
    const seqStr = seq.toString().padStart(8, '0')
    const body = `SEQ:${seqStr}:${payload}`
    const checksum = computeCrc(body)
    const line = `${body}:${checksum}\n`
    chunk += line
  }

  totalBytes += chunk.length

  // Check duration
  if (totalLines === 0 && Date.now() - startTime >= durationMs) {
    process.stdout.write(chunk)
    process.stdout.write(`BENCH_DONE:${seq}:${totalBytes}\n`, () => {
      process.exit(0)
    })
    return
  }

  // Respect backpressure
  const canWrite = process.stdout.write(chunk)
  if (canWrite) {
    // stdout buffer has space — continue immediately
    setImmediate(writeBatch)
  } else {
    // stdout buffer full — wait for drain before continuing
    process.stdout.once('drain', writeBatch)
  }
}

// Start generating
writeBatch()
