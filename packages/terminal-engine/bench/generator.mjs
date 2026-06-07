#!/usr/bin/env node
// Pure JavaScript benchmark generator — no tsx/TypeScript dependency.
// Outputs sequenced, CRC32-checksummed lines at maximum throughput.
// Format: SEQ:00000001:payload:CRC32HEX\n

import { crc32 } from 'node:zlib'

const args = process.argv.slice(2)
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal
}

const totalLines = parseInt(getArg('lines', '0'), 10)
const payloadSize = parseInt(getArg('payload-size', '200'), 10)
const durationMs = parseInt(getArg('duration-ms', '10000'), 10)
const prefix = getArg('prefix', 'T0')

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function makePayload(seq, size) {
  const base = `${prefix}:${seq.toString(36)}:`
  let payload = base
  let i = 0
  while (payload.length < size) {
    payload += chars[(seq * 7 + i * 13) % chars.length]
    i++
  }
  return payload.slice(0, size)
}

let seq = 0
let totalBytes = 0
const startTime = Date.now()
const batchSize = 200

function writeBatch() {
  let chunk = ''

  for (let i = 0; i < batchSize; i++) {
    seq++

    if (totalLines > 0 && seq > totalLines) {
      if (chunk) process.stdout.write(chunk)
      process.stdout.write(`BENCH_DONE:${seq - 1}:${totalBytes + chunk.length}\n`, () => process.exit(0))
      return
    }

    const payload = makePayload(seq, payloadSize)
    const seqStr = seq.toString().padStart(8, '0')
    const body = `SEQ:${seqStr}:${payload}`
    const checksum = crc32(Buffer.from(body)).toString(16).padStart(8, '0')
    chunk += `${body}:${checksum}\n`
  }

  totalBytes += chunk.length

  if (totalLines === 0 && Date.now() - startTime >= durationMs) {
    process.stdout.write(chunk)
    process.stdout.write(`BENCH_DONE:${seq}:${totalBytes}\n`, () => process.exit(0))
    return
  }

  const canWrite = process.stdout.write(chunk)
  if (canWrite) {
    setImmediate(writeBatch)
  } else {
    process.stdout.once('drain', writeBatch)
  }
}

writeBatch()
