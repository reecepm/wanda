// -----------------------------------------------------------------------------
// HTTP request router.
//
// Owns the per-request pipeline for the server's HTTP listener: CORS preflight,
// the optional pre-handler (auth / pairing / capabilities), the `/agent-status`
// webhook (self-authenticated, runs before the RPC gate), the RPC auth gate,
// and the oRPC handler fallthrough. Pure wiring — the handlers it composes live
// in their own modules.
// -----------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RPCHandler } from '@orpc/server/node'
import { log } from '../packages/logger'

export interface HttpRouterDeps {
  /** The oRPC node handler that serves every matched RPC call. */
  readonly rpcHandler: RPCHandler<object>
  /** POST `/agent-status` handler (self-authenticated via the hook token). */
  readonly handleAgentStatus: (req: IncomingMessage, res: ServerResponse) => void
  /**
   * Optional pre-handler consulted BEFORE the oRPC router. Returns `true` if
   * the request was fully handled.
   */
  readonly extraHttpHandler?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
  /**
   * Optional gate applied to every request that reaches the oRPC handler.
   * Returns `true` to allow, `false` to reject with 401.
   */
  readonly authenticateRpc?: (req: IncomingMessage) => boolean | Promise<boolean>
}

/** Build the `http.createServer` request listener for the server runtime. */
export function makeHttpRequestHandler(deps: HttpRouterDeps) {
  const { rpcHandler, handleAgentStatus, extraHttpHandler, authenticateRpc } = deps

  return async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS: the web build is served from a different origin (e.g.
    // http://localhost:5173 via Vite) than the server's bind host, so
    // browsers enforce CORS on every fetch. Electron's renderer bypasses
    // this because it loads via file://. Auth is via Bearer header, not
    // cookies, so `*` origin is safe here and matches the loopback-only
    // deployment model.
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'content-type, authorization, x-orpc-signature, x-agent-session-id, x-wanda-hook-token',
    )
    res.setHeader('Access-Control-Expose-Headers', 'etag')
    res.setHeader('Access-Control-Max-Age', '86400')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Pre-handlers (auth / pairing / capabilities) run before the oRPC
    // router so they can respond with their own status codes.
    if (extraHttpHandler) {
      try {
        const handled = await extraHttpHandler(req, res)
        if (handled) return
      } catch (err) {
        log.main.warn('extraHttpHandler threw:', err)
        if (!res.headersSent) {
          res.writeHead(500)
          res.end('internal error')
        }
        return
      }
    }

    // Agent status webhook — hooks POST here from inside agent processes.
    // Runs before the RPC auth gate, so it self-authenticates with the
    // per-server hook token before any side effects.
    if (req.method === 'POST' && req.url === '/agent-status') {
      handleAgentStatus(req, res)
      return
    }

    // RPC authentication gate (when configured). Runs after the auth
    // endpoints and webhook, gating everything else.
    if (authenticateRpc) {
      let allowed = false
      try {
        allowed = (await authenticateRpc(req)) === true
      } catch (err) {
        log.main.warn('authenticateRpc threw:', err)
      }
      if (!allowed) {
        res.writeHead(401, { 'content-type': 'text/plain' })
        res.end('unauthorized')
        return
      }
    }

    const { matched } = await rpcHandler.handle(req, res)
    if (!matched) {
      res.writeHead(404)
      res.end()
    }
  }
}
