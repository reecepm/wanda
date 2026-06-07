#!/usr/bin/env node

// ---------------------------------------------------------------------------
// Concurrent benchmark worker — runs INSIDE a PTY.
//
// Does TWO things simultaneously:
// 1. Generates CRC32-checksummed output at high speed (like generator.mjs)
// 2. Echoes back any input lines it receives with an "ECHO:" prefix
//
// This simulates the real-world scenario: heavy output streaming (like
// Claude Code thinking) while the user types input simultaneously.
//
// Output lines:  SEQ:00000001:prefix:payload:CRC32\n
// Echo lines:    ECHO:original_line\n
//
// The verifier on the receiving end separates these by prefix and checks:
// - Output stream: ordering, CRC integrity, no drops
// - Echo stream: input arrives back in the same order it was sent
// ---------------------------------------------------------------------------

import { createInterface } from 'node:readline'
import { crc32 } from 'node:zlib'

const args = process.argv.slice(2)
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal
}

const durationMs = parseInt(getArg('duration-ms', '10000'), 10)
const payloadSize = parseInt(getArg('payload-size', '200'), 10)
const prefix = getArg('prefix', 'OUT')

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

// --- Input echo (runs concurrently with output generation) ---
// Disable echo first so PTY doesn't double-echo
try {
  const { execSync } = await import('node:child_process')
  execSync('stty raw -echo', { stdio: 'inherit' })
} catch {
  /* not a TTY */
}

const rl = createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  // Echo input back with ECHO: prefix so verifier can distinguish it
  process.stdout.write(`ECHO:${line}\n`)
})

// --- Output generation ---
let seq = 0
let totalBytes = 0
const startTime = Date.now()
const batchSize = 200

function writeBatch() {
  let chunk = ''

  for (let i = 0; i < batchSize; i++) {
    seq++
    const payload = makePayload(seq, payloadSize)
    const seqStr = seq.toString().padStart(8, '0')
    const body = `SEQ:${seqStr}:${payload}`
    const checksum = crc32(Buffer.from(body)).toString(16).padStart(8, '0')
    chunk += `${body}:${checksum}\n`
  }

  totalBytes += chunk.length

  if (Date.now() - startTime >= durationMs) {
    process.stdout.write(chunk)
    process.stdout.write(`BENCH_DONE:${seq}:${totalBytes}\n`, () => {
      // Keep running for a bit to echo any remaining input
      setTimeout(() => process.exit(0), 2000)
    })
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
