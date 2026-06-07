#!/usr/bin/env node

// Simple echo server for roundtrip benchmarks.
// Disables terminal echo immediately, then pipes stdin → stdout line by line.
// This avoids the PTY local echo that causes duplicates with plain `cat`.

import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

// Disable echo on the TTY fd directly
try {
  // Using child_process to run stty synchronously before we start reading
  const { execSync } = await import('node:child_process')
  execSync('stty raw -echo', { stdio: 'inherit' })
} catch (err) {
  // Expected: stty fails when stdin is not a TTY (e.g. piped input in tests).
  // In that case we just pass through without disabling echo.
  process.stderr.write(`[echoserver] stty setup skipped: ${err.message}\n`)
}

// Use readline to process line by line for clean boundary handling
const rl = createInterface({ input: process.stdin, terminal: false })

rl.on('line', (line) => {
  process.stdout.write(line + '\n')
})

rl.on('close', () => {
  process.exit(0)
})
