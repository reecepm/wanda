/**
 * Watches PTY output for localhost/dev-server URLs and fires a callback
 * the first time a new URL is detected per stream. Handles:
 *   - ANSI escape code stripping
 *   - Cross-chunk URL detection (small tail buffer)
 *   - Per-stream dedup so the same URL doesn't fire twice
 *   - Cooldown after restart (tools re-print URLs on HMR)
 */

// Strip ANSI escape sequences (CSI, OSC, simple escapes)
const ANSI_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[()][AB012]|[78=>])/g

// Match localhost-style URLs (http/https, localhost/127.0.0.1/0.0.0.0, with port)
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{1,5})(?:\/\S*)?/g

// How many chars to keep from the end of each chunk to catch URLs split across writes
const TAIL_BUFFER_SIZE = 256

// After a URL fires, suppress the same URL for this stream for this long
const DEDUP_COOLDOWN_MS = 10_000

export type UrlDetectedCallback = (streamId: string, url: string) => void

interface StreamState {
  tail: string
  /** Map<url, lastFiredAt> */
  seen: Map<string, number>
}

export class UrlWatcher {
  private streams = new Map<string, StreamState>()
  private callback: UrlDetectedCallback

  constructor(callback: UrlDetectedCallback) {
    this.callback = callback
  }

  /** Feed a chunk of PTY data for a given stream. */
  feed(streamId: string, data: string): void {
    let state = this.streams.get(streamId)
    if (!state) {
      state = { tail: '', seen: new Map() }
      this.streams.set(streamId, state)
    }

    // Combine tail from previous chunk with current data, then strip ANSI
    const raw = state.tail + data
    const clean = raw.replace(ANSI_RE, '')

    // Extract all matching URLs
    for (const match of clean.matchAll(URL_RE)) {
      // Normalise: strip trailing punctuation that's likely not part of the URL
      const url = match[0].replace(/[.,;:!?)}\]]+$/, '')
      const now = Date.now()
      const lastFired = state.seen.get(url)
      if (lastFired && now - lastFired < DEDUP_COOLDOWN_MS) continue
      state.seen.set(url, now)
      this.callback(streamId, url)
    }

    // Keep the tail for cross-chunk matching
    const stripped = data.replace(ANSI_RE, '')
    state.tail = stripped.length > TAIL_BUFFER_SIZE ? stripped.slice(-TAIL_BUFFER_SIZE) : stripped
  }

  /** Reset state for a stream (call on command restart). */
  reset(streamId: string): void {
    this.streams.delete(streamId)
  }

  /** Clean up all state. */
  dispose(): void {
    this.streams.clear()
  }
}
