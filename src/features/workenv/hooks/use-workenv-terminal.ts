// useWorkenvTerminal — owns a single xterm.js instance backed by a workenv
// exec stream.
//
// Bypasses the shared TerminalRegistry on purpose: that registry routes
// keystrokes to `window.wanda.terminal.write` (pod PTYs); workenv streams
// need to go through the `workenv.exec*` oRPC routes instead. Keeping
// the workenv terminal in its own hook avoids cross-bleeding between the
// two pipelines.

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { getTransportFor, TERMINAL_THEME } from '@/features/terminal'
import { orpcUtils } from '@/shared/orpc'

interface UseWorkenvTerminalOpts {
  workenvId: string | null
  cmd?: string
  args?: string[]
  enabled?: boolean
}

interface UseWorkenvTerminalResult {
  containerRef: React.RefObject<HTMLDivElement | null>
  streamId: string | null
  exitCode: number | null
  error: string | null
  /** Restart the session — destroys the current stream and spawns a new one. */
  restart: () => void
}

export function useWorkenvTerminal({
  workenvId,
  cmd = '/bin/sh',
  args,
  enabled = true,
}: UseWorkenvTerminalOpts): UseWorkenvTerminalResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [streamId, setStreamId] = useState<string | null>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restartTick, setRestartTick] = useState(0)

  useEffect(() => {
    void restartTick
    if (!enabled || !workenvId || !containerRef.current) return
    let cancelled = false
    let term: Terminal | null = null
    let fit: FitAddon | null = null
    let activeStreamId: string | null = null
    let unsubData: (() => void) | null = null
    let unsubExit: (() => void) | null = null
    let resizeObserver: ResizeObserver | null = null
    let receivedExit = false

    const start = async () => {
      await Promise.resolve()
      if (cancelled) return
      setError(null)
      setExitCode(null)

      try {
        const result = await orpcUtils.workenv.execStart.call({
          id: workenvId,
          cmd,
          args,
          pty: true,
        })
        if (cancelled) {
          // We were torn down between request and response — clean up.
          await orpcUtils.workenv.execDestroy.call({ streamId: result.streamId }).catch(() => undefined)
          return
        }
        activeStreamId = result.streamId
        setStreamId(activeStreamId)

        term = new Terminal({
          theme: TERMINAL_THEME,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: 13,
          cursorBlink: true,
          scrollback: 5000,
          allowProposedApi: true,
        })
        fit = new FitAddon()
        term.loadAddon(fit)
        if (containerRef.current) {
          term.open(containerRef.current)
          fit.fit()
        }

        // Wire keystrokes back to the server.
        term.onData((data) => {
          if (!activeStreamId) return
          void orpcUtils.workenv.execWrite.call({ streamId: activeStreamId, data })
        })

        term.onResize((dims) => {
          if (!activeStreamId) return
          void orpcUtils.workenv.execResize.call({
            streamId: activeStreamId,
            cols: dims.cols,
            rows: dims.rows,
          })
        })

        // Subscribe to the existing terminal:data / :exit channels — the
        // exec service bridges adapter ExecSession output through them.
        const transport = getTransportFor(activeStreamId)
        unsubData = transport.onData(activeStreamId, (data) => {
          term?.write(data)
        })
        unsubExit = transport.onExit(activeStreamId, (code) => {
          receivedExit = true
          setExitCode(code)
          term?.write(`\r\n[exited with code ${code}]\r\n`)
        })

        // Replay the server-side scrollback we may have missed before
        // subscribing — covers the case where exec output happened in the
        // tick between start() returning and us wiring the data handler.
        // `exitCode` being non-null means the session already finished
        // before we subscribed to `onExit`, so we surface it here to
        // avoid hanging the UI forever.
        const snapshot = await orpcUtils.workenv.execGetScrollback.call({ streamId: activeStreamId })
        if (!cancelled && snapshot.scrollback) {
          term?.write(snapshot.scrollback)
        }
        if (!cancelled && snapshot.exitCode != null && !receivedExit) {
          setExitCode(snapshot.exitCode)
          term?.write(`\r\n[exited with code ${snapshot.exitCode}]\r\n`)
        }

        if (containerRef.current) {
          resizeObserver = new ResizeObserver(() => fit?.fit())
          resizeObserver.observe(containerRef.current)
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    void start()

    return () => {
      cancelled = true
      unsubData?.()
      unsubExit?.()
      resizeObserver?.disconnect()
      if (activeStreamId) {
        void orpcUtils.workenv.execDestroy.call({ streamId: activeStreamId }).catch(() => undefined)
      }
      term?.dispose()
      setStreamId(null)
    }
  }, [workenvId, enabled, restartTick, cmd, args])

  return {
    containerRef,
    streamId,
    exitCode,
    error,
    restart: () => setRestartTick((t) => t + 1),
  }
}
