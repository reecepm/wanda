/** Configuration for creating a new terminal instance. */
export interface PtyConfig {
  /** Working directory for the shell process. */
  cwd: string
  /** Shell executable (defaults to $SHELL or bash). */
  command?: string
  /** Arguments to pass to the shell. */
  args?: string[]
  /** Additional environment variables merged into the process env. */
  env?: Record<string, string>
  /** Initial column count (default 80). */
  cols?: number
  /** Initial row count (default 30). */
  rows?: number
  /** Restart policy: 'always', 'on-failure', or 'never' (default). */
  restartPolicy?: 'always' | 'on-failure' | 'never'
  /** Per-terminal exit callback. Fired when the PTY process exits. */
  onExit?: (id: string, exitCode: number) => void
}

/** Public info about a terminal instance. */
export interface TerminalInfo {
  id: string
  config: PtyConfig
  status: 'running' | 'stopped' | 'crashed'
  exitCode?: number
  restartCount: number
}

/** Options for the TerminalEngine. */
export interface EngineOptions {
  /** High watermark in bytes — pause PTY when unacked data exceeds this (default 100_000). */
  highWaterMark?: number
  /** Low watermark in bytes — resume PTY when unacked data drops below this (default 5_000). */
  lowWaterMark?: number
  /** Batching interval in ms — flush accumulated output on this timer (default 16). */
  batchIntervalMs?: number
  /** Batching size threshold in bytes — flush when accumulated output exceeds this (default 128_000). */
  batchMaxBytes?: number
  /** Snapshot flush interval in ms (default 5_000). */
  snapshotIntervalMs?: number
  /** Snapshot flush byte threshold (default 50_000). */
  snapshotThresholdBytes?: number
  /** Directory for scrollback persistence. Omit to disable persistence. */
  snapshotDir?: string
  /** Optional logger. */
  log?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void
}

/** Runtime metrics from the engine. */
export interface EngineMetrics {
  /** Number of active terminal instances. */
  terminals: number
  /** Per-terminal metrics keyed by terminal ID. */
  perTerminal: Map<
    string,
    {
      /** Total bytes received from PTY since creation. */
      bytesOut: number
      /** Total bytes written to PTY since creation. */
      bytesIn: number
      /** Bytes sent but not yet acked by client. */
      unackedBytes: number
      /** Whether the PTY is currently paused (backpressure). */
      paused: boolean
      /** Number of times the PTY was paused. */
      pauseCount: number
    }
  >
}

/** Env vars that should not leak into spawned terminals. */
export const STRIPPED_ENV_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'ORIGINAL_XPC_SERVICE_NAME',
  'VITE_DEV_SERVER_URL',
  'ELECTRON_RENDERER_URL',
]
