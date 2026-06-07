// -----------------------------------------------------------------------------
// Deterministic idempotency key generation.
//
// Format: `hash(v=1|<clientId>|<entryId>)`. Version-prefixed so hashing
// scheme changes don't collide with prior keys — a future v=2 variant can
// be emitted alongside, and the server ledger stores both in dedup checks.
//
// Hash is SHA-256 (node:crypto). Truncated base64url-encoded to 128 bits
// (22 chars). That's plenty to avoid collisions at Wanda's scale while
// keeping the key compact on the wire.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto'

export const IDEMPOTENCY_VERSION = '1' as const

export function makeIdempotencyKey(clientId: string, entryId: string, version: string = IDEMPOTENCY_VERSION): string {
  if (!clientId) throw new Error('makeIdempotencyKey: clientId required')
  if (!entryId) throw new Error('makeIdempotencyKey: entryId required')
  const input = `v=${version}|${clientId}|${entryId}`
  const digest = createHash('sha256').update(input).digest()
  // 16 bytes = 128 bits; base64url drops padding.
  return 'v' + version + ':' + digest.subarray(0, 16).toString('base64url')
}
