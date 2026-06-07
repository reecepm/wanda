#!/usr/bin/env tsx

// ---------------------------------------------------------------------------
// Benchmark harness — CLI orchestrator for all test scenarios.
//
// Usage:
//   tsx bench/harness.ts                                # all scenarios
//   tsx bench/harness.ts --scenario throughput           # single terminal flood
//   tsx bench/harness.ts --scenario roundtrip            # input ordering
//   tsx bench/harness.ts --scenario multi --terminals 10 # N-terminal
//   tsx bench/harness.ts --duration 20000                # 20s per scenario
//   tsx bench/harness.ts --json                          # JSON output only
// ---------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TerminalEngine } from '../src/engine.js'
import { MetricsCollector } from './metrics.js'
import { type BenchmarkReport, generateReport, printReport } from './report.js'
import { InputEchoVerifier, StreamVerifier } from './verifier.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const generatorPath = join(__dirname, 'generator.mjs')

// Parse CLI args
const args = process.argv.slice(2)
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal
}
const hasFlag = (name: string) => args.includes(`--${name}`)

const scenario = getArg('scenario', 'all')
const terminalCount = parseInt(getArg('terminals', '10'), 10)
const durationMs = parseInt(getArg('duration', '10000'), 10)
const jsonOnly = hasFlag('json')

function log(msg: string) {
  if (!jsonOnly) console.log(msg)
}

// ---------------------------------------------------------------------------
// Scenario: throughput — single terminal, max output speed
// ---------------------------------------------------------------------------
async function scenarioThroughput(): Promise<BenchmarkReport> {
  log('\n--- Scenario: throughput (single terminal flood) ---')

  const tmpDir = mkdtempSync(join(tmpdir(), 'wanda-bench-'))
  const engine = new TerminalEngine({ snapshotDir: tmpDir })
  await engine.ready
  const verifier = new StreamVerifier('T0', 'T0')
  const metrics = new MetricsCollector()

  const id = engine.create({
    cwd: process.cwd(),
    command: 'node',
    args: [generatorPath, '--prefix', 'T0', '--duration-ms', durationMs.toString()],
  })
  engine.subscribe(id)

  metrics.register(id)

  const unsub = engine.on('data', (termId, data) => {
    if (termId === id) {
      verifier.feed(data)
      const lineCount = data.split('\n').length - 1
      metrics.recordBytes(id, data.length)
      metrics.recordLines(id, lineCount)
      // Ack immediately — no WS client in CLI mode
      engine.ack(id, data.length)
    }
  })

  // Wait for completion
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (verifier.done) {
        clearInterval(check)
        resolve()
      }
    }, 100)

    // Safety timeout
    setTimeout(() => {
      clearInterval(check)
      resolve()
    }, durationMs + 5000)
  })

  unsub()
  const result = verifier.getResult()
  const report = generateReport('throughput', [result])

  engine.dispose()
  metrics.dispose()
  return report
}

// ---------------------------------------------------------------------------
// Scenario: roundtrip — input ordering via cat echo
// ---------------------------------------------------------------------------
async function scenarioRoundtrip(): Promise<BenchmarkReport> {
  log('\n--- Scenario: roundtrip (input ordering via cat) ---')

  const tmpDir = mkdtempSync(join(tmpdir(), 'wanda-bench-'))
  const engine = new TerminalEngine({ snapshotDir: tmpDir })
  await engine.ready
  const verifier = new StreamVerifier('RT', 'RT')

  const echoServerPath = join(__dirname, 'echoserver.mjs')
  const id = engine.create({
    cwd: process.cwd(),
    command: 'node',
    args: [echoServerPath],
  })
  engine.subscribe(id)

  const unsub = engine.on('data', (termId, data) => {
    if (termId === id) {
      verifier.feed(data)
      engine.ack(id, data.length)
    }
  })

  // Wait for echo server to initialize (stty + readline setup)
  await new Promise((r) => setTimeout(r, 500))

  // Send sequenced lines through the engine's write path
  const totalLines = 5000
  const { crc32: crc32Fn } = await import('node:zlib')

  for (let seq = 1; seq <= totalLines; seq++) {
    const seqStr = seq.toString().padStart(8, '0')
    const payload = `RT:${seq.toString(36)}:` + 'X'.repeat(50)
    const body = `SEQ:${seqStr}:${payload}`
    const checksum = crc32Fn(Buffer.from(body)).toString(16).padStart(8, '0')
    engine.write(id, `${body}:${checksum}\n`)
  }

  // Send done sentinel
  engine.write(id, `BENCH_DONE:${totalLines}:0\n`)

  // Wait for all lines to echo back
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (verifier.done || verifier.totalLines >= totalLines) {
        clearInterval(check)
        resolve()
      }
    }, 100)

    setTimeout(() => {
      clearInterval(check)
      resolve()
    }, 15000)
  })

  unsub()
  const result = verifier.getResult()
  const report = generateReport('roundtrip', [result])

  engine.destroy(id)
  engine.dispose()
  return report
}

// ---------------------------------------------------------------------------
// Scenario: multi — N terminals with generators, no cross-contamination
// ---------------------------------------------------------------------------
async function scenarioMulti(): Promise<BenchmarkReport> {
  log(`\n--- Scenario: multi (${terminalCount} terminals) ---`)

  const tmpDir = mkdtempSync(join(tmpdir(), 'wanda-bench-'))
  const engine = new TerminalEngine({ snapshotDir: tmpDir })
  await engine.ready
  const verifiers = new Map<string, StreamVerifier>()
  const terminalIds: string[] = []
  const metrics = new MetricsCollector()

  for (let i = 0; i < terminalCount; i++) {
    const prefix = `T${i}`
    const id = engine.create({
      cwd: process.cwd(),
      command: 'node',
      args: [generatorPath, '--prefix', prefix, '--duration-ms', durationMs.toString()],
    })
    engine.subscribe(id)
    terminalIds.push(id)
    const verifier = new StreamVerifier(prefix, prefix)
    verifiers.set(id, verifier)
    metrics.register(id)
  }

  const unsub = engine.on('data', (id, data) => {
    const verifier = verifiers.get(id)
    if (verifier) {
      verifier.feed(data)
      const lineCount = data.split('\n').length - 1
      metrics.recordBytes(id, data.length)
      metrics.recordLines(id, lineCount)
      engine.ack(id, data.length)
    }
  })

  // Print progress
  const progressTimer = jsonOnly
    ? null
    : setInterval(() => {
        const snap = metrics.snapshot()
        const mbps = (snap.aggregateBytesPerSec / 1024 / 1024).toFixed(1)
        const doneCount = Array.from(verifiers.values()).filter((v) => v.done).length
        process.stdout.write(`\r  ${doneCount}/${terminalCount} done, ${mbps} MB/s aggregate  `)
      }, 500)

  // Wait for all to complete
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      const allDone = Array.from(verifiers.values()).every((v) => v.done)
      if (allDone) {
        clearInterval(check)
        resolve()
      }
    }, 200)

    setTimeout(() => {
      clearInterval(check)
      resolve()
    }, durationMs + 10000)
  })

  if (progressTimer) {
    clearInterval(progressTimer)
    process.stdout.write('\r' + ' '.repeat(60) + '\r')
  }

  unsub()
  const results = Array.from(verifiers.values()).map((v) => v.getResult())
  const report = generateReport('multi', results)

  engine.dispose()
  metrics.dispose()
  return report
}

// ---------------------------------------------------------------------------
// Scenario: concurrent — type input while heavy output is streaming
//
// This is the critical real-world scenario: a user typing in a terminal
// while output is flooding (e.g. Claude Code streaming a response while
// the user types the next prompt). Tests that:
// - Input keystrokes are not starved by output processing
// - Input arrives back in the correct order despite output contention
// - Input latency stays bounded even under heavy output load
// ---------------------------------------------------------------------------
async function scenarioConcurrent(): Promise<BenchmarkReport> {
  log(`\n--- Scenario: concurrent (typing + ${terminalCount} bg terminals flooding) ---`)

  const tmpDir = mkdtempSync(join(tmpdir(), 'wanda-bench-'))
  const engine = new TerminalEngine({ snapshotDir: tmpDir })
  await engine.ready
  const concurrentWorkerPath = join(__dirname, 'concurrent-worker.mjs')

  const outputVerifier = new StreamVerifier('OUT', 'OUT')
  const inputVerifier = new InputEchoVerifier()
  const metrics = new MetricsCollector()

  // Background terminals — NOT subscribed (PTYs run, raw log accumulates in host)
  for (let i = 0; i < terminalCount; i++) {
    engine.create({
      cwd: process.cwd(),
      command: 'node',
      args: [generatorPath, '--prefix', `BG${i}`, '--duration-ms', durationMs.toString()],
    })
  }

  // Active terminal — subscribed, with both output generation and input echo
  const id = engine.create({
    cwd: process.cwd(),
    command: 'node',
    args: [concurrentWorkerPath, '--prefix', 'OUT', '--duration-ms', durationMs.toString()],
  })
  engine.subscribe(id)

  metrics.register(id)

  const unsub = engine.on('data', (termId, data) => {
    if (termId !== id) return
    outputVerifier.feed(data)
    inputVerifier.feed(data)
    const lineCount = data.split('\n').length - 1
    metrics.recordBytes(id, data.length)
    metrics.recordLines(id, lineCount)
    engine.ack(id, data.length)
  })

  // Wait for the worker to start generating output
  await new Promise((r) => setTimeout(r, 800))

  // Now simulate typing input while output is streaming.
  // Send input at a realistic typing speed (~100 WPM = ~8 chars/sec)
  // but in bursts to also stress the fast-paste case.
  const inputLines = 200
  inputVerifier.setExpectedTotal(inputLines)
  let inputsSent = 0

  // Send input lines at a steady rate while output is streaming.
  // Mix of burst (paste-like) and individual (typing-like) sends.
  const inputTimer = setInterval(() => {
    // Send a burst of 3-5 lines per tick (simulates fast pasting amid output)
    const burstSize = 3 + Math.floor(Math.random() * 3)
    for (let i = 0; i < burstSize; i++) {
      inputsSent++
      if (inputsSent > inputLines) return
      const seqStr = inputsSent.toString().padStart(8, '0')
      const payload = 'the quick brown fox jumps over the lazy dog'
      const line = `INP:${seqStr}:${payload}`
      inputVerifier.recordSend(inputsSent)
      engine.write(id, `${line}\n`)
    }
  }, 50)

  // Wait for output generator to finish AND all input echoes to return
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (outputVerifier.done && inputVerifier.allReceived) {
        clearInterval(check)
        resolve()
      }
    }, 100)

    setTimeout(() => {
      clearInterval(check)
      resolve()
    }, durationMs + 10000)
  })

  clearInterval(inputTimer)
  unsub()

  // Build report
  const outputResult = outputVerifier.getResult()
  const inputResult = inputVerifier.getResult()
  const errors: string[] = []

  // Output correctness
  if (outputResult.orderingViolations > 0)
    errors.push(`output: ${outputResult.orderingViolations} ordering violation(s)`)
  if (outputResult.crcFailures > 0) errors.push(`output: ${outputResult.crcFailures} CRC failure(s)`)
  if (outputResult.drops > 0) errors.push(`output: ${outputResult.drops} dropped line(s)`)

  // Input correctness
  if (inputResult.orderingViolations > 0) errors.push(`input: ${inputResult.orderingViolations} ordering violation(s)`)
  if (inputResult.missing > 0) errors.push(`input: ${inputResult.missing} missing echo(es)`)

  // Input latency
  const sortedLatencies = [...inputResult.latencies].sort((a, b) => a - b)
  const p50 = sortedLatencies.length > 0 ? sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] : 0
  const p95 = sortedLatencies.length > 0 ? sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] : 0
  const p99 = sortedLatencies.length > 0 ? sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] : 0

  if (!jsonOnly) {
    log(`  Output: ${outputResult.totalLines.toLocaleString()} lines, ${outputResult.throughputMBps.toFixed(1)} MB/s`)
    log(`  Input echoed: ${inputResult.totalEchoed}/${inputLines}`)
    log(`  Input latency: p50=${p50.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  p99=${p99.toFixed(1)}ms`)
  }

  // Use a synthetic VerifyResult for the report system
  const combinedResult = outputResult
  const report = generateReport('concurrent', [combinedResult])

  // Override with our more complete error list
  report.errors = errors
  report.passed = errors.length === 0

  engine.dispose()
  metrics.dispose()
  return report
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log(`\n${'='.repeat(60)}`)
  log(`  @wanda/terminal-engine benchmark`)
  log(`  Duration: ${durationMs / 1000}s per scenario`)
  log(`  Terminals: ${terminalCount} (for multi scenario)`)
  log(`${'='.repeat(60)}`)

  const reports: BenchmarkReport[] = []

  if (scenario === 'all' || scenario === 'throughput') {
    reports.push(await scenarioThroughput())
  }
  if (scenario === 'all' || scenario === 'roundtrip') {
    reports.push(await scenarioRoundtrip())
  }
  if (scenario === 'all' || scenario === 'multi') {
    reports.push(await scenarioMulti())
  }
  if (scenario === 'all' || scenario === 'concurrent') {
    reports.push(await scenarioConcurrent())
  }

  // Print reports
  if (jsonOnly) {
    console.log(JSON.stringify(reports, null, 2))
  } else {
    for (const report of reports) {
      printReport(report)
    }

    const allPassed = reports.every((r) => r.passed)
    console.log(`\n${'='.repeat(60)}`)
    if (allPassed) {
      console.log(`  \x1b[32mAll scenarios passed.\x1b[0m`)
    } else {
      console.log(`  \x1b[31mSome scenarios failed.\x1b[0m`)
    }
    console.log(`${'='.repeat(60)}\n`)

    process.exit(allPassed ? 0 : 1)
  }
}

main().catch((err) => {
  console.error('Benchmark harness error:', err)
  process.exit(1)
})
