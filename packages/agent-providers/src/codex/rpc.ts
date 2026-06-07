// -----------------------------------------------------------------------------
// Minimal JSON-RPC 2.0 client for `codex app-server`. Newline-delimited
// framing over Node streams (stdin + stdout), bidirectional: we send
// requests + notifications and handle both server-initiated notifications
// and server-to-client requests.
//
// This framer is intentionally small: we don't ship the full Codex type
// surface, only the methods + notification kinds the v1 provider needs.
// The full generated-schema path (spec §12.3) is a future enhancement —
// when it lands, this framer stays; only `protocol.ts` grows.
// -----------------------------------------------------------------------------

import type { Readable, Writable } from 'node:stream'

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id: number | string
  readonly method: string
  readonly params?: unknown
}

export interface JsonRpcNotification {
  readonly jsonrpc: '2.0'
  readonly method: string
  readonly params?: unknown
}

export interface JsonRpcSuccessResponse {
  readonly jsonrpc: '2.0'
  readonly id: number | string
  readonly result: unknown
}

export interface JsonRpcErrorResponse {
  readonly jsonrpc: '2.0'
  readonly id: number | string | null
  readonly error: { readonly code: number; readonly message: string; readonly data?: unknown }
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse

export type JsonRpcFrame = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse

/**
 * Base class for every failure mode exposed by this client. Callers can
 * discriminate on `kind` without importing every subclass.
 *
 *   - `transport` — stream closed, write failed, stdout ended.
 *   - `parse`     — malformed JSON frame received from the subprocess.
 *   - `request`   — Codex returned a JSON-RPC error response.
 *   - `timeout`   — a request exceeded its deadline before the server
 *                   replied (the underlying pending entry is cleared; if
 *                   Codex eventually answers, the reply is dropped).
 */
export abstract class CodexRpcError extends Error {
  abstract readonly kind: 'transport' | 'parse' | 'request' | 'timeout'
}

export class CodexRequestError extends CodexRpcError {
  readonly kind = 'request' as const
  readonly code: number
  readonly data?: unknown
  constructor(message: string, code: number, data?: unknown) {
    super(message)
    this.name = 'CodexRequestError'
    this.code = code
    this.data = data
  }
}

export class CodexTransportError extends CodexRpcError {
  readonly kind = 'transport' as const
  override readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'CodexTransportError'
    this.cause = cause
  }
}

export class CodexProtocolParseError extends CodexRpcError {
  readonly kind = 'parse' as const
  readonly rawLine?: string
  constructor(message: string, rawLine?: string) {
    super(message)
    this.name = 'CodexProtocolParseError'
    this.rawLine = rawLine
  }
}

export class CodexTimeoutError extends CodexRpcError {
  readonly kind = 'timeout' as const
  readonly method: string
  readonly timeoutMs: number
  constructor(method: string, timeoutMs: number) {
    super(`codex rpc: ${method} exceeded ${timeoutMs}ms`)
    this.name = 'CodexTimeoutError'
    this.method = method
    this.timeoutMs = timeoutMs
  }
}

export interface CodexRpcHandlers {
  /** Server-initiated notification (no reply). */
  readonly onNotification?: (method: string, params: unknown) => void
  /**
   * Server-to-client request. Must return a result to resolve the server's
   * pending call, or throw `CodexRequestError` to reply with an error code.
   */
  readonly onRequest?: (method: string, params: unknown) => Promise<unknown>
  /** Transport-level failure (stdout closed, parse error). Recoverable only by reconnect. */
  readonly onTransportError?: (err: CodexRpcError) => void
}

/**
 * Optional per-call knobs for `request()`. If omitted, the call uses the
 * client's default timeout (60s) and has no external abort signal.
 */
export interface CodexRequestOptions {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

export interface CodexRpcClient {
  /** Send a JSON-RPC request and await the response. */
  readonly request: <T = unknown>(method: string, params?: unknown, opts?: CodexRequestOptions) => Promise<T>
  /** Send a notification; no reply expected. */
  readonly notify: (method: string, params?: unknown) => void
  /** Close the transport (no new outbound frames; drain pending with rejection). */
  readonly close: (reason?: string) => void
}

/** Default deadline for `request()` when the caller doesn't override. */
export const CODEX_RPC_DEFAULT_TIMEOUT_MS = 60_000

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (err: Error) => void
}

/**
 * Build an RPC client pinned to a pre-opened stdin + stdout pair. The
 * caller is responsible for closing those streams — `close()` here only
 * rejects pending calls and installs a "do not use me" guard.
 */
export function makeCodexRpcClient(opts: {
  readonly stdin: Writable
  readonly stdout: Readable
  readonly handlers?: CodexRpcHandlers
}): CodexRpcClient {
  const { stdin, stdout, handlers } = opts
  const pending = new Map<number, Pending>()
  let nextId = 1
  let closed = false

  // Opt-in wire tracing. Set WANDA_CODEX_DEBUG=1 in the environment to get
  // one-line summaries of every frame flowing in and out of the Codex RPC
  // channel — used to diagnose protocol drift (e.g. "missing field X"
  // rejections from the Rust server).
  const debug = typeof process !== 'undefined' && !!process.env?.WANDA_CODEX_DEBUG

  function send(frame: JsonRpcFrame): void {
    const line = `${JSON.stringify(frame)}\n`
    if (debug) {
      if ('id' in frame && 'method' in frame) {
        console.error(`[codex-rpc] → request #${frame.id} ${frame.method} ${truncate(JSON.stringify(frame.params))}`)
      } else if ('method' in frame) {
        console.error(`[codex-rpc] → notify ${frame.method} ${truncate(JSON.stringify(frame.params))}`)
      } else if ('id' in frame) {
        const tag = 'error' in frame ? 'error' : 'result'
        console.error(`[codex-rpc] → reply #${String(frame.id)} ${tag}`)
      }
    }
    try {
      stdin.write(line)
    } catch (err) {
      handlers?.onTransportError?.(
        new CodexTransportError(`codex rpc: write failed: ${err instanceof Error ? err.message : String(err)}`, err),
      )
    }
  }

  function truncate(s: string | undefined): string {
    if (!s) return ''
    return s.length > 400 ? `${s.slice(0, 400)}…` : s
  }

  function dispatchResponse(frame: JsonRpcResponse): void {
    const id = typeof frame.id === 'number' ? frame.id : null
    if (id == null) return
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if ('error' in frame) {
      p.reject(new CodexRequestError(frame.error.message, frame.error.code, frame.error.data))
    } else {
      p.resolve(frame.result)
    }
  }

  async function dispatchRequest(frame: JsonRpcRequest): Promise<void> {
    if (!handlers?.onRequest) {
      send({
        jsonrpc: '2.0',
        id: frame.id,
        error: { code: -32_601, message: `No handler for method ${frame.method}` },
      })
      return
    }
    try {
      const result = await handlers.onRequest(frame.method, frame.params ?? null)
      if (closed) return
      send({ jsonrpc: '2.0', id: frame.id, result: result ?? null })
    } catch (err) {
      if (closed) return
      const e = err instanceof CodexRequestError ? err : null
      send({
        jsonrpc: '2.0',
        id: frame.id,
        error: {
          code: e?.code ?? -32_603,
          message: err instanceof Error ? err.message : String(err),
          data: e?.data,
        },
      })
    }
  }

  // Line-buffered JSON parser. Codex frames its messages as NDJSON on
  // stdout — one JSON object per line. Partial chunks are accumulated
  // until a `\n` splits them.
  let buffer = ''
  const onData = (chunk: Buffer | string): void => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let idx = buffer.indexOf('\n')
    while (idx !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (line.length > 0) processLine(line)
      idx = buffer.indexOf('\n')
    }
  }

  function processLine(line: string): void {
    let frame: unknown
    try {
      frame = JSON.parse(line)
    } catch (err) {
      handlers?.onTransportError?.(
        new CodexProtocolParseError(
          `codex rpc: malformed line: ${err instanceof Error ? err.message : String(err)}`,
          line,
        ),
      )
      return
    }
    if (!isObject(frame)) return
    if ('id' in frame && ('result' in frame || 'error' in frame)) {
      if (debug) {
        const id = (frame as { id: unknown }).id
        if ('error' in frame) {
          const e = (frame as { error: { code?: number; message?: string } }).error
          console.error(`[codex-rpc] ← error #${String(id)} code=${e?.code} ${e?.message ?? ''}`)
        } else {
          console.error(
            `[codex-rpc] ← result #${String(id)} ${truncate(JSON.stringify((frame as { result: unknown }).result))}`,
          )
        }
      }
      dispatchResponse(frame as unknown as JsonRpcResponse)
      return
    }
    if ('method' in frame && 'id' in frame) {
      if (debug) {
        const f = frame as { id: unknown; method: string; params?: unknown }
        console.error(`[codex-rpc] ← request #${String(f.id)} ${f.method} ${truncate(JSON.stringify(f.params))}`)
      }
      void dispatchRequest(frame as unknown as JsonRpcRequest)
      return
    }
    if ('method' in frame) {
      const n = frame as unknown as JsonRpcNotification
      if (debug) {
        console.error(`[codex-rpc] ← notify ${n.method} ${truncate(JSON.stringify(n.params))}`)
      }
      try {
        handlers?.onNotification?.(n.method, n.params ?? null)
      } catch (err) {
        handlers?.onTransportError?.(
          new CodexTransportError(
            `codex rpc: notification handler threw: ${err instanceof Error ? err.message : String(err)}`,
            err,
          ),
        )
      }
      return
    }
    // Unknown frame shape — ignore.
  }

  stdout.setEncoding('utf8')
  stdout.on('data', onData)
  stdout.on('error', (err) =>
    handlers?.onTransportError?.(new CodexTransportError(`codex rpc: stdout error: ${err.message}`, err)),
  )
  stdout.on('close', () => {
    if (closed) return
    closed = true
    const err = new CodexTransportError('codex rpc: stdout closed')
    for (const [, p] of pending) p.reject(err)
    pending.clear()
    handlers?.onTransportError?.(err)
  })

  return {
    request(method, params, reqOpts) {
      const timeoutMs = reqOpts?.timeoutMs ?? CODEX_RPC_DEFAULT_TIMEOUT_MS
      const signal = reqOpts?.signal
      return new Promise((resolve, reject) => {
        if (closed) {
          reject(new CodexTransportError('codex rpc: client closed'))
          return
        }
        if (signal?.aborted) {
          reject(abortReason(signal))
          return
        }
        const id = nextId++
        // Deadline timer — on fire, drop the pending entry and reject.
        // Codex may still respond later; we ignore the stale reply because
        // dispatchResponse short-circuits when `pending.get(id)` is empty.
        const deadline = setTimeout(() => {
          if (!pending.has(id)) return
          pending.delete(id)
          reject(new CodexTimeoutError(method, timeoutMs))
        }, timeoutMs)
        // If the caller provides an AbortSignal, honour it. Matches the
        // Promise-based cancellation pattern used elsewhere in the runtime.
        const onAbort = () => {
          if (!pending.has(id)) return
          pending.delete(id)
          clearTimeout(deadline)
          reject(abortReason(signal!))
        }
        if (signal) signal.addEventListener('abort', onAbort, { once: true })

        pending.set(id, {
          resolve: (value) => {
            clearTimeout(deadline)
            if (signal) signal.removeEventListener('abort', onAbort)
            resolve(value as never)
          },
          reject: (err) => {
            clearTimeout(deadline)
            if (signal) signal.removeEventListener('abort', onAbort)
            reject(err)
          },
        })
        send({ jsonrpc: '2.0', id, method, params: params ?? null })
      }) as Promise<never>
    },
    notify(method, params) {
      if (closed) return
      send({ jsonrpc: '2.0', method, params: params ?? null })
    },
    close(reason) {
      if (closed) return
      closed = true
      const err = new CodexTransportError(reason ?? 'codex rpc: closed')
      for (const [, p] of pending) p.reject(err)
      pending.clear()
      stdout.off('data', onData)
    },
  }
}

function abortReason(signal: AbortSignal): Error {
  // DOMException-style reason when provided, wrapped so it always extends Error.
  const reason = signal.reason
  if (reason instanceof Error) return reason
  return new CodexTransportError(typeof reason === 'string' && reason.length > 0 ? reason : 'codex rpc: aborted')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
