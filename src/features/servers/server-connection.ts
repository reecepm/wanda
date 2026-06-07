// Per-paired-server oRPC client factory.
//
// Wraps `@orpc/client/fetch`'s RPCLink with an Authorization: Bearer header
// derived from the server's session token. The token is read from a
// closure so it can be updated in place (e.g. on a 401 refresh without
// rebuilding the link).
//
// Returns a typed `AppClient` so callers get full autocomplete against
// the paired server's RPC surface — `client.pod.list({ ... })` works the
// same as the local `orpc` client, just against a different URL.

import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppClient } from '../../../shared/contracts'

export interface PairedServerClient {
  readonly client: AppClient
  /** Swap the session token used on subsequent calls (e.g. after revocation + re-pair). */
  setSessionToken(token: string): void
}

export interface CreatePairedServerClientOpts {
  readonly baseUrl: string
  readonly sessionToken: string
  /** Override fetch — tests inject a stub. */
  readonly fetchImpl?: typeof fetch
}

export function createPairedServerClient(opts: CreatePairedServerClientOpts): PairedServerClient {
  let token = opts.sessionToken
  const link = new RPCLink({
    url: opts.baseUrl.replace(/\/$/, ''),
    headers: () => ({ authorization: `Bearer ${token}` }),
    ...(opts.fetchImpl ? { fetch: opts.fetchImpl as typeof fetch } : {}),
  })
  const client = createORPCClient<AppClient>(link)
  return {
    client,
    setSessionToken(next) {
      token = next
    },
  }
}
