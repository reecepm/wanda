// -----------------------------------------------------------------------------
// JSON-RPC 2.0 framer tests. Uses in-memory PassThrough streams to simulate
// the subprocess; no child_process, no Codex binary.
// -----------------------------------------------------------------------------

import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  CodexProtocolParseError,
  CodexRequestError,
  CodexRpcError,
  CodexTimeoutError,
  CodexTransportError,
  makeCodexRpcClient,
} from '../rpc.ts'

function makePair() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  return { stdin, stdout }
}

function collectStdin(stream: PassThrough): Promise<string[]> {
  const lines: string[] = []
  return new Promise((resolve) => {
    let buf = ''
    stream.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      let idx = buf.indexOf('\n')
      while (idx !== -1) {
        lines.push(buf.slice(0, idx))
        buf = buf.slice(idx + 1)
        idx = buf.indexOf('\n')
        if (lines.length >= 100) {
          resolve(lines)
          return
        }
      }
    })
    setTimeout(() => resolve(lines), 50)
  })
}

describe('makeCodexRpcClient', () => {
  it('serialises a request with an auto-incrementing id and resolves on matching response', async () => {
    const { stdin, stdout } = makePair()
    const client = makeCodexRpcClient({ stdin, stdout })
    const got = client.request('initialize', { a: 1 })
    // Simulate Codex replying on the next tick.
    setImmediate(() => {
      stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } })}\n`)
    })
    const result = await got
    expect(result).toEqual({ ok: true })
  })

  it('routes errors into CodexRequestError with code + message', async () => {
    const { stdin, stdout } = makePair()
    const client = makeCodexRpcClient({ stdin, stdout })
    const got = client.request('model/list')
    setImmediate(() => {
      stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32_601, message: 'Method not found' },
        })}\n`,
      )
    })
    await expect(got).rejects.toMatchObject({
      name: 'CodexRequestError',
      kind: 'request',
      code: -32_601,
      message: 'Method not found',
    })
  })

  it('dispatches notifications to the handler without replying', async () => {
    const { stdin, stdout } = makePair()
    const notes: Array<{ method: string; params: unknown }> = []
    makeCodexRpcClient({
      stdin,
      stdout,
      handlers: { onNotification: (method, params) => notes.push({ method, params }) },
    })
    stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'turn/started', params: { turnId: 't1' } })}\n`)
    // Give dispatcher time to run.
    await new Promise((r) => setTimeout(r, 10))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toEqual({ method: 'turn/started', params: { turnId: 't1' } })
  })

  it('answers server-to-client requests with the handler result', async () => {
    const { stdin, stdout } = makePair()
    const writesP = collectStdin(stdin)
    makeCodexRpcClient({
      stdin,
      stdout,
      handlers: {
        onRequest: async (method) => {
          expect(method).toBe('item/commandExecution/requestApproval')
          return { decision: 'accept' }
        },
      },
    })
    stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 42,
        method: 'item/commandExecution/requestApproval',
        params: {},
      })}\n`,
    )
    await new Promise((r) => setTimeout(r, 20))
    const writes = await writesP
    const reply = writes.find((l) => l.includes('"id":42'))
    expect(reply).toBeTruthy()
    expect(JSON.parse(reply!)).toEqual({
      jsonrpc: '2.0',
      id: 42,
      result: { decision: 'accept' },
    })
  })

  it('returns -32601 when no request handler is registered', async () => {
    const { stdin, stdout } = makePair()
    const writesP = collectStdin(stdin)
    makeCodexRpcClient({ stdin, stdout })
    stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'something/unknown', params: {} })}\n`)
    await new Promise((r) => setTimeout(r, 20))
    const writes = await writesP
    const reply = writes.find((l) => l.includes('"id":7'))
    expect(reply).toBeTruthy()
    const parsed = JSON.parse(reply!)
    expect(parsed.error.code).toBe(-32_601)
  })

  it('handles partial chunks that split JSON lines across data events', async () => {
    const { stdin, stdout } = makePair()
    const client = makeCodexRpcClient({ stdin, stdout })
    const got = client.request('initialize')
    const frame = `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: 1 } })}\n`
    stdout.write(frame.slice(0, 10))
    setImmediate(() => stdout.write(frame.slice(10)))
    expect(await got).toEqual({ ok: 1 })
  })

  it('rejects pending callers on stdout close with a CodexTransportError', async () => {
    const { stdin, stdout } = makePair()
    const client = makeCodexRpcClient({ stdin, stdout })
    const got = client.request('never/responds')
    setImmediate(() => stdout.end())
    await expect(got).rejects.toMatchObject({
      name: 'CodexTransportError',
      kind: 'transport',
    })
  })

  it('close() rejects in-flight requests with a CodexTransportError carrying the reason', async () => {
    const { stdin, stdout } = makePair()
    const client = makeCodexRpcClient({ stdin, stdout })
    const got = client.request('never/responds')
    client.close('test shutdown')
    await expect(got).rejects.toMatchObject({
      name: 'CodexTransportError',
      kind: 'transport',
      message: 'test shutdown',
    })
  })

  it('rejects with CodexTimeoutError when a request exceeds its deadline', async () => {
    const { stdin, stdout } = makePair()
    const client = makeCodexRpcClient({ stdin, stdout })
    const got = client.request('slow/call', undefined, { timeoutMs: 20 })
    await expect(got).rejects.toMatchObject({
      name: 'CodexTimeoutError',
      kind: 'timeout',
      method: 'slow/call',
      timeoutMs: 20,
    })
  })

  it('honours an external AbortSignal by rejecting the pending call', async () => {
    const { stdin, stdout } = makePair()
    const client = makeCodexRpcClient({ stdin, stdout })
    const ctl = new AbortController()
    const got = client.request('slow/call', undefined, { signal: ctl.signal })
    setImmediate(() => ctl.abort(new Error('user cancelled')))
    await expect(got).rejects.toThrow(/user cancelled/)
  })

  it('surfaces parse failures to onTransportError as CodexProtocolParseError', async () => {
    const { stdin, stdout } = makePair()
    const seen: Array<{ name: string; kind: string }> = []
    makeCodexRpcClient({
      stdin,
      stdout,
      handlers: {
        onTransportError: (err) => seen.push({ name: err.name, kind: err.kind }),
      },
    })
    stdout.write('this is not json\n')
    await new Promise((r) => setTimeout(r, 20))
    expect(seen.some((e) => e.name === 'CodexProtocolParseError' && e.kind === 'parse')).toBe(true)
  })
})

// Silence TS unused-import warnings when only the types matter.
void CodexRpcError
void CodexProtocolParseError
void CodexTransportError
void CodexTimeoutError
void CodexRequestError
