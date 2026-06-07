// ---------------------------------------------------------------------------
// Benchmark web UI — connects to the engine server, creates N terminal
// panes with xterm.js + WebGL, runs generators, and displays live metrics
// with verification status.
// ---------------------------------------------------------------------------

import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { WsTerminalClient } from '../../src/ws-client.js'
import { StreamVerifier } from '../verifier.js'

// --- Config from URL params ---
const params = new URLSearchParams(window.location.search)
const serverUrl = params.get('server') ?? 'ws://localhost:9191/terminal'
const benchUrl = params.get('bench') ?? 'ws://localhost:9191/bench'
const token = params.get('token') ?? ''

// --- State ---
let client: WsTerminalClient | null = null
let benchWs: WebSocket | null = null
let panes: TerminalPane[] = []
let frameTimeSamples: number[] = []
let lastFrameTime = 0
let rafId = 0
let metricsTimer: ReturnType<typeof setInterval> | null = null

interface TerminalPane {
  id: string // engine terminal ID
  prefix: string
  term: Terminal
  fit: FitAddon
  container: HTMLDivElement
  verifier: StreamVerifier
  unsub: (() => void) | null
  headerEl: HTMLDivElement
  badgeEl: HTMLDivElement
  bytesReceived: number
  linesReceived: number
}

// --- DOM refs ---
const grid = document.getElementById('terminal-grid')!
const btnStart = document.getElementById('btn-start') as HTMLButtonElement
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement
const termCountInput = document.getElementById('term-count') as HTMLInputElement
const durationSelect = document.getElementById('duration') as HTMLSelectElement

// Metric displays
const mTerminals = document.getElementById('m-terminals')!
const mThroughput = document.getElementById('m-throughput')!
const mLines = document.getElementById('m-lines')!
const mFrametime = document.getElementById('m-frametime')!
const mOrdering = document.getElementById('m-ordering')!
const mCrc = document.getElementById('m-crc')!
const mDrops = document.getElementById('m-drops')!

// --- Frame timing ---
function measureFrames() {
  const now = performance.now()
  if (lastFrameTime > 0) {
    frameTimeSamples.push(now - lastFrameTime)
    // Keep last 300 samples (~5s at 60fps)
    if (frameTimeSamples.length > 300) frameTimeSamples.shift()
  }
  lastFrameTime = now
  rafId = requestAnimationFrame(measureFrames)
}

function getFrameTimeP99(): number {
  if (frameTimeSamples.length === 0) return 0
  const sorted = [...frameTimeSamples].sort((a, b) => a - b)
  const idx = Math.ceil(0.99 * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

// --- Grid layout ---
function computeGridLayout(count: number): { cols: number; rows: number } {
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  return { cols, rows }
}

// --- Create terminal pane ---
function createPane(prefix: string): TerminalPane {
  const container = document.createElement('div')
  container.className = 'terminal-pane'

  const header = document.createElement('div')
  header.className = 'pane-header'
  header.innerHTML = `<span>${prefix}</span><span class="pane-status pending">...</span>`
  container.appendChild(header)

  const badge = document.createElement('div')
  badge.className = 'verify-badge pending'
  badge.textContent = 'verifying'
  container.appendChild(badge)

  const term = new Terminal({
    fontSize: 10,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    scrollback: 1000,
    theme: {
      background: '#0d0d0d',
      foreground: '#d4d4d4',
    },
  })

  const fit = new FitAddon()
  term.loadAddon(fit)

  grid.appendChild(container)
  term.open(container)

  // Try WebGL renderer
  try {
    term.loadAddon(new WebglAddon())
  } catch (err) {
    console.warn(`[bench] WebGL addon failed for ${prefix}, falling back to canvas:`, err)
  }

  // Delay fit to ensure container has dimensions
  requestAnimationFrame(() => fit.fit())

  const verifier = new StreamVerifier(prefix, prefix)

  return {
    id: '', // Set after engine creates it
    prefix,
    term,
    fit,
    container,
    verifier,
    unsub: null,
    headerEl: header,
    badgeEl: badge,
    bytesReceived: 0,
    linesReceived: 0,
  }
}

// --- Start benchmark ---
async function startBenchmark() {
  btnStart.disabled = true
  btnStop.disabled = false
  frameTimeSamples = []

  const count = parseInt(termCountInput.value, 10) || 8
  const duration = parseInt(durationSelect.value, 10) || 10000

  // Connect to engine server
  client = new WsTerminalClient({ url: serverUrl, token })

  // Wait for connection
  await new Promise<void>((resolve) => {
    const unsub = client!.onConnection((status) => {
      if (status === 'connected') {
        unsub()
        resolve()
      }
    })
    // Timeout
    setTimeout(() => resolve(), 3000)
  })

  // Update grid layout
  const layout = computeGridLayout(count)
  grid.style.gridTemplateColumns = `repeat(${layout.cols}, 1fr)`
  grid.style.gridTemplateRows = `repeat(${layout.rows}, 1fr)`
  mTerminals.textContent = count.toString()

  // Create panes
  // Note: terminal IDs are received from the engine server via a separate
  // control channel. For the benchmark, we use a simplified approach where
  // the bench server creates terminals and sends their IDs.
  for (let i = 0; i < count; i++) {
    const prefix = `T${i}`
    const pane = createPane(prefix)
    panes.push(pane)
  }

  // Connect bench control socket and request terminal creation
  benchWs = new WebSocket(benchUrl)

  benchWs.addEventListener('open', () => {
    benchWs!.send(JSON.stringify({ t: 'bench:start', count, duration }))
  })

  benchWs.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data as string)
      if (msg.t === 'bench:ids' && Array.isArray(msg.ids)) {
        const ids = msg.ids as string[]
        for (let i = 0; i < Math.min(ids.length, panes.length); i++) {
          const pane = panes[i]
          pane.id = ids[i]

          // Subscribe to data via the terminal WS client
          pane.unsub = client!.onData(ids[i], (data) => {
            pane.term.write(data)
            pane.verifier.feed(data)
            pane.bytesReceived += data.length
            pane.linesReceived += (data.match(/\n/g) || []).length
          })
        }
      }
    } catch (err) {
      console.warn('[bench-ui] failed to parse bench control message:', err)
    }
  })

  // Start frame measurement
  rafId = requestAnimationFrame(measureFrames)

  // Start metrics updates
  metricsTimer = setInterval(updateMetrics, 200)
}

// --- Stop benchmark ---
function stopBenchmark() {
  btnStart.disabled = false
  btnStop.disabled = true

  cancelAnimationFrame(rafId)
  if (metricsTimer) clearInterval(metricsTimer)

  // Final metrics update
  updateMetrics()

  // Cleanup
  for (const pane of panes) {
    pane.unsub?.()
    pane.term.dispose()
    pane.container.remove()
  }
  panes = []
  benchWs?.close()
  benchWs = null
  client?.dispose()
  client = null
}

// --- Update metrics display ---
function updateMetrics() {
  let totalBytes = 0
  let totalLines = 0
  let totalOrdering = 0
  let totalCrc = 0
  let totalDrops = 0

  for (const pane of panes) {
    const result = pane.verifier.getResult()
    totalBytes += pane.bytesReceived
    totalLines += pane.linesReceived
    totalOrdering += result.orderingViolations
    totalCrc += result.crcFailures
    totalDrops += result.drops

    // Update per-pane badge
    const statusEl = pane.headerEl.querySelector('.pane-status')!
    if (result.done) {
      statusEl.textContent = pane.verifier.passes() ? 'PASS' : 'FAIL'
      statusEl.className = `pane-status ${pane.verifier.passes() ? 'ok' : 'err'}`
      pane.badgeEl.textContent = `${result.totalLines.toLocaleString()} lines`
      pane.badgeEl.className = `verify-badge ${pane.verifier.passes() ? 'pass' : 'fail'}`
    } else {
      statusEl.textContent = `${result.totalLines.toLocaleString()}`
      statusEl.className = 'pane-status'
      const mbps = result.throughputMBps.toFixed(1)
      pane.badgeEl.textContent = `${mbps} MB/s`
    }
  }

  // Aggregate metrics
  const elapsed = panes[0]?.verifier.getResult().elapsedMs ?? 1
  const throughputMBps = elapsed > 0 ? totalBytes / elapsed / 1000 : 0

  mThroughput.textContent = `${throughputMBps.toFixed(1)} MB/s`
  mThroughput.className = `metric-value ${throughputMBps > 10 ? 'good' : 'neutral'}`

  mLines.textContent = Math.round(elapsed > 0 ? (totalLines / elapsed) * 1000 : 0).toLocaleString()

  const p99 = getFrameTimeP99()
  mFrametime.textContent = `${p99.toFixed(1)}ms p99`
  mFrametime.className = `metric-value ${p99 < 8.33 ? 'good' : p99 < 16.67 ? 'neutral' : 'bad'}`

  mOrdering.textContent = `${totalOrdering} violations`
  mOrdering.className = `metric-value ${totalOrdering === 0 ? 'good' : 'bad'}`

  mCrc.textContent = `${totalCrc} failures`
  mCrc.className = `metric-value ${totalCrc === 0 ? 'good' : 'bad'}`

  mDrops.textContent = totalDrops.toString()
  mDrops.className = `metric-value ${totalDrops === 0 ? 'good' : 'bad'}`

  // Check if all done
  const allDone = panes.length > 0 && panes.every((p) => p.verifier.done)
  if (allDone) {
    stopBenchmark()
  }
}

// --- Resize handler ---
const resizeObserver = new ResizeObserver(() => {
  for (const pane of panes) {
    pane.fit.fit()
  }
})
resizeObserver.observe(grid)

// --- Wire up buttons ---
btnStart.addEventListener('click', startBenchmark)
btnStop.addEventListener('click', stopBenchmark)
