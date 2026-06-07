#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PtyHost — child process that owns all PTY instances.
//
// Communicates with the TerminalEngine via binary-framed stdio pipes:
//   stdin  ← commands from engine (write, resize, create, etc.)
//   stdout → events to engine (data, exit, scrollback replies)
//   stderr → diagnostic logs
//
// Uses separate unidirectional pipes to eliminate the deadlock risk
// inherent in Node.js IPC's single bidirectional socket.
// ---------------------------------------------------------------------------

import { write as fsWrite } from 'node:fs'
import { Batcher } from './batcher.js'
import { FlowController } from './flow-control.js'
import { PtyHandle } from './pty-handle.js'
import {
  buildDataPayload,
  buildExitPayload,
  buildScrollbackReply,
  type CreatePayload,
  FrameDecoder,
  HostCmd,
  HostEvt,
  ID_BYTES,
  writeFrame,
} from './pty-host-protocol.js'
import { SnapshotStore } from './snapshot-store.js'

// --- Config from argv ---
const snapshotDir = process.argv[2] || ''
const highWaterMark = parseInt(process.argv[3] || '100000', 10)
const lowWaterMark = parseInt(process.argv[4] || '5000', 10)
const batchIntervalMs = parseInt(process.argv[5] || '4', 10)
const batchMaxBytes = parseInt(process.argv[6] || '128000', 10)

// --- State ---
const handles = new Map<string, PtyHandle>()
const flowControllers = new Map<string, FlowController>()
const subscribedTerminals = new Set<string>()
const store = snapshotDir
  ? new SnapshotStore(snapshotDir, (ctx, err) => {
      console.error(`[pty-host:snapshot] ${ctx}:`, err)
    })
  : null
store?.init().catch((err: unknown) => console.error('[pty-host] snapshot init failed:', err))

const dirtyStreams = new Set<string>()
const bytesSinceFlush = new Map<string, number>()
const SNAPSHOT_INTERVAL_MS = 5_000
const SNAPSHOT_THRESHOLD_BYTES = 50_000

// --- stdout backpressure ---
let anyPtyPaused = false

function pauseAllSubscribedPtys(): void {
  if (anyPtyPaused) return
  anyPtyPaused = true
  for (const id of subscribedTerminals) {
    handles.get(id)?.pause()
  }
}

function resumeAllSubscribedPtys(): void {
  if (!anyPtyPaused) return
  anyPtyPaused = false
  for (const id of subscribedTerminals) {
    handles.get(id)?.resume()
  }
}

process.stdout.on('drain', () => {
  resumeAllSubscribedPtys()
})

// --- Write to PTY via fd (async, non-blocking) ---
interface WriteQueueEntry {
  id: string
  buf: Buffer
}

const writeQueue: WriteQueueEntry[] = []
let writeQueueBytes = 0
let writeFlushing = false
let writeBackoffMs = 0
const WRITE_BACKOFF_MIN = 2
const WRITE_BACKOFF_MAX = 50

function enqueuePtyWrite(id: string, data: string): void {
  const buf = Buffer.from(data, 'utf-8')
  writeQueue.push({ id, buf })
  writeQueueBytes += buf.length
  if (!writeFlushing) flushWriteQueue()
}

function flushWriteQueue(): void {
  if (writeQueue.length === 0) {
    writeFlushing = false
    return
  }
  writeFlushing = true

  const entry = writeQueue[0]
  const handle = handles.get(entry.id)

  if (!handle) {
    // Terminal was destroyed — discard
    writeQueueBytes -= entry.buf.length
    writeQueue.shift()
    setImmediate(flushWriteQueue)
    return
  }

  // Try direct fd write first (non-blocking)
  const ptyFd = (handle as unknown as { ptyProcess?: { fd?: number } }).ptyProcess?.fd
  if (typeof ptyFd === 'number') {
    fsWrite(ptyFd, entry.buf, 0, entry.buf.length, null, (err, bytesWritten) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EAGAIN' || code === 'EWOULDBLOCK') {
          writeBackoffMs = Math.min(
            Math.max(writeBackoffMs || WRITE_BACKOFF_MIN, writeBackoffMs * 2),
            WRITE_BACKOFF_MAX,
          )
          setTimeout(flushWriteQueue, writeBackoffMs)
          return
        }
        // Other error — fall back to pty.write() for this entry
        handle.write(entry.buf.toString('utf-8'))
        writeQueueBytes -= entry.buf.length
        writeQueue.shift()
        writeBackoffMs = 0
        setImmediate(flushWriteQueue)
        return
      }

      writeBackoffMs = 0
      if (bytesWritten < entry.buf.length) {
        // Partial write — keep remainder
        entry.buf = entry.buf.subarray(bytesWritten)
        writeQueueBytes -= bytesWritten
        setImmediate(flushWriteQueue)
      } else {
        writeQueueBytes -= entry.buf.length
        writeQueue.shift()
        setImmediate(flushWriteQueue)
      }
    })
  } else {
    // No fd available — synchronous fallback
    handle.write(entry.buf.toString('utf-8'))
    writeQueueBytes -= entry.buf.length
    writeQueue.shift()
    setImmediate(flushWriteQueue)
  }
}

// --- Output batcher ---
const batcher = new Batcher(
  (id, data, _byteCount) => {
    const fc = flowControllers.get(id)
    if (subscribedTerminals.has(id)) {
      fc?.sent(data.length)
      const payload = buildDataPayload(id, data)
      const canWrite = writeFrame(process.stdout, HostEvt.Data, payload)
      if (!canWrite) {
        pauseAllSubscribedPtys()
      }
    }
  },
  { intervalMs: batchIntervalMs, maxBytes: batchMaxBytes },
)

// --- Snapshot management ---
function trackDirty(id: string, bytes: number): void {
  if (!store) return
  dirtyStreams.add(id)
  const acc = (bytesSinceFlush.get(id) ?? 0) + bytes
  bytesSinceFlush.set(id, acc)
  if (acc >= SNAPSHOT_THRESHOLD_BYTES) flushSnapshot(id)
}

function flushSnapshot(id: string): void {
  if (!store || !dirtyStreams.has(id)) return
  const handle = handles.get(id)
  if (!handle?.headless) return
  handle.flushHeadless()
  const dims = { cols: handle.config.cols ?? 80, rows: handle.config.rows ?? 30 }
  store.writeSnapshot(id, handle.headless.serialize(), {
    cols: dims.cols,
    rows: dims.rows,
    timestamp: Date.now(),
    rawlogOffset: store.getRawLogOffset(id),
  })
  dirtyStreams.delete(id)
  bytesSinceFlush.set(id, 0)
}

const snapshotTimer = store
  ? setInterval(() => {
      for (const id of dirtyStreams) flushSnapshot(id)
    }, SNAPSHOT_INTERVAL_MS)
  : null

// --- Frame handler ---
function handleFrame(type: number, payload: Buffer): void {
  switch (type) {
    case HostCmd.Create: {
      const { id, config } = JSON.parse(payload.toString('utf-8')) as CreatePayload
      const handle = new PtyHandle(id, config)
      const fc = new FlowController(
        { pause: () => handle.pause(), resume: () => handle.resume() },
        { highWaterMark, lowWaterMark },
      )

      handle.onError((ctx, err) => console.error(`[pty-host:${id.slice(0, 8)}] ${ctx}:`, err))

      handle.onData((data) => {
        store?.appendRawLog(id, data)
        if (subscribedTerminals.has(id)) {
          trackDirty(id, data.length)
          batcher.push(id, data)
        }
      })

      handle.onExit((code) => {
        batcher.flush(id)
        fc.reset()
        const exitPayload = buildExitPayload(id, code)
        writeFrame(process.stdout, HostEvt.Exit, exitPayload)
      })

      handles.set(id, handle)
      flowControllers.set(id, fc)
      break
    }

    case HostCmd.Write: {
      const id = payload.toString('ascii', 0, ID_BYTES)
      const data = payload.toString('utf-8', ID_BYTES)
      enqueuePtyWrite(id, data)
      break
    }

    case HostCmd.Resize: {
      const id = payload.toString('ascii', 0, ID_BYTES)
      const cols = payload.readUInt16LE(ID_BYTES)
      const rows = payload.readUInt16LE(ID_BYTES + 2)
      handles.get(id)?.resize(cols, rows)
      break
    }

    case HostCmd.Destroy: {
      const id = payload.toString('ascii', 0, ID_BYTES)
      batcher.remove(id)
      flowControllers.delete(id)
      subscribedTerminals.delete(id)
      handles.get(id)?.kill()
      handles.delete(id)
      dirtyStreams.delete(id)
      bytesSinceFlush.delete(id)
      store?.delete(id)
      break
    }

    case HostCmd.Ack: {
      const id = payload.toString('ascii', 0, ID_BYTES)
      const bytes = payload.readUInt32LE(ID_BYTES)
      flowControllers.get(id)?.ack(bytes)
      break
    }

    case HostCmd.Subscribe: {
      const id = payload.toString('ascii', 0, ID_BYTES)
      subscribedTerminals.add(id)
      handles.get(id)?.setHeadlessActive(true)
      break
    }

    case HostCmd.Unsubscribe: {
      const id = payload.toString('ascii', 0, ID_BYTES)
      subscribedTerminals.delete(id)
      flowControllers.get(id)?.reset()
      handles.get(id)?.setHeadlessActive(false)
      break
    }

    case HostCmd.Scrollback: {
      const id = payload.toString('ascii', 0, ID_BYTES)
      const reqId = payload.readUInt32LE(ID_BYTES)
      const handle = handles.get(id)
      let data = ''
      if (handle?.headless) {
        handle.flushHeadless()
        data = handle.headless.serialize()
      }
      const replyPayload = buildScrollbackReply(reqId, data)
      writeFrame(process.stdout, HostEvt.ScrollbackReply, replyPayload)
      break
    }

    case HostCmd.Clear: {
      const id = payload.toString('ascii', 0, ID_BYTES)
      handles.get(id)?.clearScrollback()
      dirtyStreams.delete(id)
      bytesSinceFlush.delete(id)
      store?.delete(id).catch((err) => console.error(`[pty-host] clear-snapshot ${id}:`, err))
      break
    }

    case HostCmd.Dispose: {
      if (snapshotTimer) clearInterval(snapshotTimer)
      batcher.dispose()
      for (const [, handle] of handles) handle.kill()
      handles.clear()
      flowControllers.clear()
      process.exit(0)
    }
  }
}

// --- Wire stdin → frame decoder ---
const decoder = new FrameDecoder()
process.stdin.on('data', (chunk: Buffer) => {
  const frames = decoder.push(chunk)
  for (const frame of frames) {
    handleFrame(frame.type, frame.payload)
  }
})

process.stdin.on('end', () => {
  // Parent process closed stdin — shut down gracefully
  batcher.dispose()
  for (const [, handle] of handles) handle.kill()
  process.exit(0)
})

// --- Signal ready ---
writeFrame(process.stdout, HostEvt.Ready)
