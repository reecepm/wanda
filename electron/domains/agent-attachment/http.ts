// -----------------------------------------------------------------------------
// Attachment blob HTTP endpoint.
//
//   GET /attachments/:id        → 200 <bytes> | 404 | 401
//   HEAD /attachments/:id       → same, body omitted (for renderer cache sizing)
//
// Auth is bearer-based and shares the same `validateSession` call the oRPC
// router uses — no separate wsToken flow. The handler is mounted as an
// extraHttpHandler in server-handle.ts / bin.ts, composed after the auth
// handler so /api/* still routes normally.
// -----------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AttachmentId, SessionId } from '@wanda/agent-protocol'
import { Effect } from 'effect'
import { log } from '../../packages/logger'
import type { AuthStore } from '../../server/auth'
import type { AppManagedRuntime } from '../../services'
import { AgentAttachmentService } from './controller'

const ATTACHMENT_ROUTE = /^\/attachments\/([A-Za-z0-9_-]+)(?:\?.*)?$/

interface AttachmentHttpDeps {
  readonly authStore: AuthStore
  readonly appRuntime: AppManagedRuntime
}

export function makeAttachmentHttpHandler(
  deps: AttachmentHttpDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async function handle(req, res): Promise<boolean> {
    const url = req.url ?? ''
    const match = ATTACHMENT_ROUTE.exec(url)
    if (!match) return false
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return true
    }

    const authHeader = req.headers.authorization
    if (!authHeader) {
      res.writeHead(401)
      res.end('missing bearer')
      return true
    }
    const parts = authHeader.split(' ')
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      res.writeHead(401)
      res.end('invalid authorization')
      return true
    }
    const token = parts[1] ?? ''
    const session = deps.authStore.validateSession(token)
    if (!session) {
      res.writeHead(401)
      res.end('invalid session')
      return true
    }

    // The sessionId scoping header is optional. When present we gate reads
    // to attachments bound to that session (or unbound). When absent, we
    // allow the bearer to read any unbound attachment (upload-window
    // fetches) but not bound ones.
    const scopeHeader = req.headers['x-agent-session-id']
    const sessionScopeRaw = Array.isArray(scopeHeader) ? scopeHeader[0] : scopeHeader
    const sessionScope: SessionId | null =
      typeof sessionScopeRaw === 'string' && sessionScopeRaw.length > 0 ? (sessionScopeRaw as SessionId) : null

    const rawId = match[1] ?? ''
    const attachmentId = rawId as AttachmentId

    try {
      const row = await deps.appRuntime.runPromise(
        Effect.flatMap(AgentAttachmentService, (svc) => svc.findReadable(attachmentId, sessionScope)),
      )
      if (!row) {
        res.writeHead(404)
        res.end('not found')
        return true
      }

      res.writeHead(200, {
        'content-type': row.mimeType,
        'content-length': row.byteSize,
        'cache-control': 'private, max-age=31536000, immutable',
        etag: `"${row.sha256}"`,
      })
      if (req.method === 'HEAD') {
        res.end()
        return true
      }

      const stream = await deps.appRuntime.runPromise(
        Effect.flatMap(AgentAttachmentService, (svc) => svc.readStream(row)),
      )
      stream.on('error', (err: Error) => {
        log.main.warn('attachment read stream error', { id: rawId, err })
        if (!res.headersSent) {
          res.writeHead(500)
          res.end('stream error')
        } else {
          res.destroy(err)
        }
      })
      // Client aborted the HTTP connection mid-stream — tear down the
      // disk read so we don't keep pumping bytes into a dead socket.
      const onClientClose = (): void => {
        if ('destroy' in stream && typeof stream.destroy === 'function') {
          try {
            stream.destroy()
          } catch {
            /* ignore */
          }
        }
      }
      res.on('close', onClientClose)
      stream.pipe(res)
      return true
    } catch (err) {
      log.main.warn('attachment handler threw', { id: rawId, err })
      if (!res.headersSent) {
        res.writeHead(500)
        res.end('internal error')
      }
      return true
    }
  }
}
