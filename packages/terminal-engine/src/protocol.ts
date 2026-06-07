// ---------------------------------------------------------------------------
// Wire protocol for the terminal engine WebSocket transport.
//
// Short single-char keys minimise JSON overhead on the hot path.
// All messages are JSON-encoded strings over a text WebSocket frame.
// ---------------------------------------------------------------------------

/** Client → Server frames. */
export type ClientFrame =
  | { t: 'w'; id: string; d: string } // write input to PTY
  | { t: 'r'; id: string; c: number; r: number } // resize PTY
  | { t: 'a'; id: string; n: number } // ack N bytes (flow control)
  | { t: 's'; id: string } // subscribe to terminal data
  | { t: 'u'; id: string } // unsubscribe from terminal data

/** Server → Client frames. */
export type ServerFrame =
  | { t: 'd'; id: string; d: string } // terminal data (batched output)
  | { t: 'x'; id: string; c: number } // terminal exit with code

/** Parse a raw WebSocket message into a ClientFrame, or null if invalid. */
export function parseClientFrame(raw: string): ClientFrame | null {
  try {
    const msg = JSON.parse(raw) as Record<string, unknown>
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return null
    switch (msg.t) {
      case 'w':
        if (typeof msg.id === 'string' && typeof msg.d === 'string') return msg as ClientFrame
        break
      case 'r':
        if (typeof msg.id === 'string' && typeof msg.c === 'number' && typeof msg.r === 'number')
          return msg as ClientFrame
        break
      case 'a':
        if (typeof msg.id === 'string' && typeof msg.n === 'number') return msg as ClientFrame
        break
      case 's':
      case 'u':
        if (typeof msg.id === 'string') return msg as ClientFrame
        break
    }
    return null
  } catch (_syntaxError) {
    // Invalid JSON — caller handles null return as "unrecognised frame"
    return null
  }
}

/** Encode a ServerFrame to a JSON string. */
export function encodeServerFrame(frame: ServerFrame): string {
  return JSON.stringify(frame)
}
