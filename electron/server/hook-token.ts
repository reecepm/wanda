// -----------------------------------------------------------------------------
// Per-server hook token.
//
// The `/agent-status` webhook runs BEFORE the RPC auth gate, so it
// self-authenticates with this token (injected into every generated hook).
// Without it, any local process could forge approval of a pending permission
// prompt. The token is minted once per process, written to a `hook-token`
// file (mode 0600) so spawned hook processes can read it, and compared with
// `timingSafeEqual` to avoid leaking length/content via timing.
// -----------------------------------------------------------------------------

import { randomBytes, timingSafeEqual } from 'node:crypto'

export interface HookTokenGuard {
  /** The minted token, injected into generated hooks and written to disk. */
  readonly value: string
  /** Constant-time comparison of a provided token against the minted one. */
  readonly matches: (provided: string | undefined) => boolean
}

export function createHookTokenGuard(): HookTokenGuard {
  const value = randomBytes(32).toString('hex')
  return {
    value,
    matches: (provided) => {
      if (!provided) return false
      const a = Buffer.from(provided)
      const b = Buffer.from(value)
      return a.length === b.length && timingSafeEqual(a, b)
    },
  }
}
