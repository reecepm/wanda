/**
 * Watches PTY output for agent approval prompts and fires a callback
 * when one is detected. Currently supports Codex's interactive approval.
 *
 * Uses a rolling buffer per stream to handle prompts split across chunks.
 */

// Strip ANSI escape sequences
const ANSI_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[()][AB012]|[78=>])/g

// Codex approval prompt patterns
const CODEX_APPROVAL_RE = /Would you like to run the following command\?/
const CODEX_COMMAND_RE = /^\s*\$\s+(.+)$/m
const CODEX_REASON_RE = /Reason:\s*(.+?)(?:\n|$)/
const CODEX_FILE_APPROVAL_RE = /Would you like to (?:apply|make) (?:this|these) (?:change|edit)/

// How many chars to keep from the end of each chunk for cross-chunk matching
const TAIL_BUFFER_SIZE = 512

// After detecting an approval, suppress re-detection for this stream for this long
const DEDUP_COOLDOWN_MS = 2_000

export interface ApprovalDetectedEvent {
  streamId: string
  toolName: string
  command?: string
}

export type ApprovalDetectedCallback = (event: ApprovalDetectedEvent) => void

interface StreamState {
  tail: string
  lastDetectedAt: number
}

export class ApprovalWatcher {
  private streams = new Map<string, StreamState>()
  private callback: ApprovalDetectedCallback

  constructor(callback: ApprovalDetectedCallback) {
    this.callback = callback
  }

  feed(streamId: string, data: string): void {
    let state = this.streams.get(streamId)
    if (!state) {
      state = { tail: '', lastDetectedAt: 0 }
      this.streams.set(streamId, state)
    }

    const raw = state.tail + data
    const clean = raw.replace(ANSI_RE, '')

    const now = Date.now()
    if (now - state.lastDetectedAt < DEDUP_COOLDOWN_MS) {
      state.tail = clean.length > TAIL_BUFFER_SIZE ? clean.slice(-TAIL_BUFFER_SIZE) : clean
      return
    }

    // Codex command approval
    if (CODEX_APPROVAL_RE.test(clean)) {
      const reasonMatch = clean.match(CODEX_REASON_RE)
      const cmdMatch = clean.match(CODEX_COMMAND_RE)
      state.lastDetectedAt = now
      this.callback({
        streamId,
        toolName: reasonMatch?.[1]?.trim() ?? cmdMatch?.[1]?.trim() ?? 'Bash',
        command: reasonMatch ? cmdMatch?.[1]?.trim() : undefined,
      })
    }

    // Codex file change approval
    if (CODEX_FILE_APPROVAL_RE.test(clean)) {
      state.lastDetectedAt = now
      this.callback({
        streamId,
        toolName: 'FileChange',
      })
    }

    state.tail = clean.length > TAIL_BUFFER_SIZE ? clean.slice(-TAIL_BUFFER_SIZE) : clean
  }

  reset(streamId: string): void {
    this.streams.delete(streamId)
  }

  dispose(): void {
    this.streams.clear()
  }
}
