// -----------------------------------------------------------------------------
// Spawn helper for Codex subprocess sessions.
// -----------------------------------------------------------------------------

import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import * as Effect from 'effect/Effect'
import { RingBuffer } from './ring-buffer.ts'

export interface SpawnOptions {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
  readonly gracefulShutdownMs?: number
  readonly forceExitMs?: number
  readonly stderrRingBytes?: number
}

export interface SpawnedAgent {
  readonly pid: number
  readonly stdin: WritableStream<Uint8Array>
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderrSnapshot: () => string
  readonly exit: Effect.Effect<{ code: number | null; signal: NodeJS.Signals | null }>
}

const SPAWN_MAX_CONCURRENT = 3
const spawnQueue: Array<() => void> = []
let spawnInFlight = 0

function acquireSpawnSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (spawnInFlight >= SPAWN_MAX_CONCURRENT) {
        spawnQueue.push(tryAcquire)
        return
      }
      spawnInFlight += 1
      let released = false
      resolve(() => {
        if (released) return
        released = true
        spawnInFlight -= 1
        const next = spawnQueue.shift()
        if (next) next()
      })
    }
    tryAcquire()
  })
}

export const spawnCodexAgent = (opts: SpawnOptions): Effect.Effect<SpawnedAgent, never, import('effect/Scope').Scope> =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const releaseSlot = await acquireSpawnSlot()
      try {
        const child = nodeSpawn(opts.command, [...opts.args], {
          cwd: opts.cwd,
          env: { ...process.env, ...(opts.env ?? {}) },
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        })
        const stderrRing = new RingBuffer(opts.stderrRingBytes ?? 2 * 1024 * 1024)
        child.stderr?.on('data', (chunk: Buffer) => stderrRing.append(chunk))
        releaseSlot()
        return {
          child,
          stderrRing,
          gracefulShutdownMs: opts.gracefulShutdownMs ?? 3_000,
          forceExitMs: opts.forceExitMs ?? 1_000,
        }
      } catch (err) {
        releaseSlot()
        throw err
      }
    }),
    ({ child, gracefulShutdownMs, forceExitMs }) =>
      Effect.async<void>((resume) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resume(Effect.void)
          return
        }
        let killTimer: ReturnType<typeof setTimeout> | null = null
        let forceTimer: ReturnType<typeof setTimeout> | null = null
        const onExit = () => {
          if (killTimer) clearTimeout(killTimer)
          if (forceTimer) clearTimeout(forceTimer)
          resume(Effect.void)
        }
        child.once('exit', onExit)

        sendSignalToTree(child, 'SIGTERM')
        killTimer = setTimeout(() => {
          sendSignalToTree(child, 'SIGKILL')
          forceTimer = setTimeout(() => {
            child.off('exit', onExit)
            console.error(
              `[agent-spawn] pid=${child.pid ?? '?'} did not exit after SIGKILL+${forceExitMs}ms; releasing scope anyway`,
            )
            resume(Effect.void)
          }, forceExitMs)
        }, gracefulShutdownMs)
      }),
  ).pipe(
    Effect.map(({ child, stderrRing }) => {
      if (child.pid == null || !child.stdin || !child.stdout) {
        throw new Error(`codex spawn: missing pid/stdin/stdout for ${opts.command}`)
      }
      return {
        pid: child.pid,
        stdin: Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        stdout: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
        stderrSnapshot: () => stderrRing.snapshot(),
        exit: waitForExit(child),
      }
    }),
  )

function sendSignalToTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid
  if (pid == null) return
  try {
    if (process.platform === 'win32') {
      child.kill(signal)
      return
    }
    process.kill(-pid, signal)
  } catch (groupErr) {
    const code = (groupErr as NodeJS.ErrnoException | undefined)?.code
    if (code && code !== 'ESRCH') {
      console.error(`[agent-spawn] process.kill(-${pid}, ${signal}) failed (${code}); falling back to child.kill`)
    }
    try {
      child.kill(signal)
    } catch (directErr) {
      const directCode = (directErr as NodeJS.ErrnoException | undefined)?.code
      if (directCode && directCode !== 'ESRCH') {
        console.error(`[agent-spawn] child.kill(${signal}) also failed (${directCode}); process may leak`)
      }
    }
  }
}

const waitForExit = (child: ChildProcess) =>
  Effect.async<{ code: number | null; signal: NodeJS.Signals | null }>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.succeed({ code: child.exitCode, signal: child.signalCode }))
      return
    }
    child.once('exit', (code, signal) => resume(Effect.succeed({ code, signal })))
  })
