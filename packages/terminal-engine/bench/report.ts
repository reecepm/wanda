// ---------------------------------------------------------------------------
// Benchmark report — automated pass/fail assertions + JSON output.
// ---------------------------------------------------------------------------

import type { VerifyResult } from './verifier.js'

export interface BenchmarkReport {
  scenario: string
  passed: boolean
  duration: number
  terminals: number
  results: VerifyResult[]
  aggregate: {
    totalLines: number
    totalBytes: number
    throughputMBps: number
    linesPerSecond: number
    orderingViolations: number
    crcFailures: number
    drops: number
    duplicates: number
    contamination: number
  }
  errors: string[]
}

export function generateReport(scenario: string, results: VerifyResult[]): BenchmarkReport {
  const errors: string[] = []
  const aggregate = {
    totalLines: 0,
    totalBytes: 0,
    throughputMBps: 0,
    linesPerSecond: 0,
    orderingViolations: 0,
    crcFailures: 0,
    drops: 0,
    duplicates: 0,
    contamination: 0,
  }

  let maxElapsed = 0
  for (const r of results) {
    aggregate.totalLines += r.totalLines
    aggregate.totalBytes += r.bytesReceived
    aggregate.throughputMBps += r.throughputMBps
    aggregate.linesPerSecond += r.linesPerSecond
    aggregate.orderingViolations += r.orderingViolations
    aggregate.crcFailures += r.crcFailures
    aggregate.drops += r.drops
    aggregate.duplicates += r.duplicates
    aggregate.contamination += r.contamination
    if (r.elapsedMs > maxElapsed) maxElapsed = r.elapsedMs
  }

  // Assertions
  if (aggregate.orderingViolations > 0) {
    errors.push(`${aggregate.orderingViolations} ordering violation(s)`)
  }
  if (aggregate.crcFailures > 0) {
    errors.push(`${aggregate.crcFailures} CRC failure(s)`)
  }
  if (aggregate.drops > 0) {
    errors.push(`${aggregate.drops} dropped line(s)`)
  }
  if (aggregate.duplicates > 0) {
    errors.push(`${aggregate.duplicates} duplicate(s)`)
  }
  if (aggregate.contamination > 0) {
    errors.push(`${aggregate.contamination} cross-terminal contamination(s)`)
  }

  return {
    scenario,
    passed: errors.length === 0,
    duration: maxElapsed,
    terminals: results.length,
    results,
    aggregate,
    errors,
  }
}

export function printReport(report: BenchmarkReport): void {
  const icon = report.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
  console.log(`\n${icon}  ${report.scenario}`)
  console.log(`  Terminals: ${report.terminals}`)
  console.log(`  Duration:  ${(report.duration / 1000).toFixed(1)}s`)
  console.log(`  Lines:     ${report.aggregate.totalLines.toLocaleString()}`)
  console.log(`  Bytes:     ${(report.aggregate.totalBytes / 1024 / 1024).toFixed(1)} MB`)
  console.log(`  Throughput: ${report.aggregate.throughputMBps.toFixed(1)} MB/s`)
  console.log(`  Lines/sec: ${report.aggregate.linesPerSecond.toLocaleString()}`)

  if (report.errors.length > 0) {
    console.log(`  \x1b[31mErrors:\x1b[0m`)
    for (const err of report.errors) {
      console.log(`    - ${err}`)
    }
  }

  // Per-terminal breakdown
  if (report.results.length > 1) {
    console.log(`\n  Per-terminal:`)
    for (const r of report.results) {
      const status =
        r.orderingViolations === 0 && r.crcFailures === 0 && r.drops === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'
      console.log(
        `    ${status} ${r.terminalId}: ${r.totalLines.toLocaleString()} lines, ` +
          `${r.throughputMBps.toFixed(1)} MB/s`,
      )
    }
  }
}
