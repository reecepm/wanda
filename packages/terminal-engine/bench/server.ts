#!/usr/bin/env tsx

// ---------------------------------------------------------------------------
// Benchmark server — starts a TerminalEngine + WS transport, and handles
// bench:start requests from the web UI to create generator terminals.
//
// Usage: tsx bench/server.ts [--port 9191]
// Then open: http://localhost:5199?server=ws://localhost:9191/terminal
// ---------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TerminalEngine } from '../src/engine.js'
import { WsTerminalServer } from '../src/ws-server.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const generatorPath = join(__dirname, 'generator.mjs')

const args = process.argv.slice(2)
const portIdx = args.indexOf('--port')
const port = portIdx >= 0 && args[portIdx + 1] ? parseInt(args[portIdx + 1], 10) : 9191

const tmpDir = mkdtempSync(join(tmpdir(), 'wanda-bench-'))

const engine = new TerminalEngine({
  snapshotDir: tmpDir,
  log: (level, msg) => {
    if (level !== 'debug') console.log(`[${level}] ${msg}`)
  },
})

const httpServer = createServer((_req, res) => {
  // CORS headers for the Vite dev server
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.writeHead(200)
  res.end('Terminal Engine Bench Server')
})

// Create the WS terminal server (handles standard terminal protocol)
const wsServer = new WsTerminalServer(engine, httpServer, {
  path: '/terminal',
  log: (level, msg) => {
    if (level !== 'debug') console.log(`[ws] ${msg}`)
  },
})

// Also handle bench-specific messages on the same WS path
// We extend the underlying WSS to intercept bench commands
const wss = (wsServer as unknown as { wss: { on: Function } }).wss
if (wss) {
  // The WsTerminalServer already handles standard frames.
  // We need to intercept bench:start at a lower level.
}

// Alternative: create a separate control WS endpoint for bench commands
import { WebSocketServer } from 'ws'

const benchWss = new WebSocketServer({ server: httpServer, path: '/bench' })

benchWss.on('connection', (ws) => {
  console.log('[bench] Control client connected')
  const activeTerminals: string[] = []

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.t === 'bench:start') {
        const count = Math.min(msg.count ?? 8, 100)
        const duration = msg.duration ?? 10000

        console.log(`[bench] Starting ${count} terminals for ${duration}ms`)

        const ids: string[] = []
        for (let i = 0; i < count; i++) {
          const prefix = `T${i}`
          const id = engine.create({
            cwd: process.cwd(),
            command: 'node',
            args: [generatorPath, '--prefix', prefix, '--duration-ms', duration.toString()],
          })
          ids.push(id)
          activeTerminals.push(id)
        }

        // Send terminal IDs back to the client
        ws.send(JSON.stringify({ t: 'bench:ids', ids }))
        console.log(`[bench] Created ${count} terminals: ${ids.join(', ')}`)
      }

      if (msg.t === 'bench:stop') {
        for (const id of activeTerminals) {
          engine.destroy(id)
        }
        activeTerminals.length = 0
        console.log('[bench] Stopped all terminals')
      }
    } catch (err) {
      console.warn('[bench] failed to parse control message:', err)
    }
  })

  ws.on('close', () => {
    // Clean up terminals when bench client disconnects
    for (const id of activeTerminals) {
      engine.destroy(id)
    }
    console.log('[bench] Control client disconnected, cleaned up terminals')
  })
})

httpServer.listen(port, () => {
  console.log(`\n${'='.repeat(50)}`)
  console.log(`  Terminal Engine Bench Server`)
  console.log(`  HTTP:     http://localhost:${port}`)
  console.log(`  Terminal: ws://localhost:${port}/terminal`)
  console.log(`  Bench:    ws://localhost:${port}/bench`)
  console.log(`${'='.repeat(50)}`)
  console.log(`\n  Open the web UI:`)
  console.log(`  http://localhost:5199?server=ws://localhost:${port}/terminal&bench=ws://localhost:${port}/bench\n`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  engine.dispose()
  wsServer.close()
  httpServer.close()
  process.exit(0)
})
process.on('SIGINT', () => {
  engine.dispose()
  wsServer.close()
  httpServer.close()
  process.exit(0)
})
