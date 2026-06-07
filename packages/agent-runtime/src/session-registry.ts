// -----------------------------------------------------------------------------
// SessionRegistry — in-memory Map<SessionId, ManagedSession>.
//
// The registry tracks residency. LRU + idle-TTL sweep is a future add (the
// sweep fiber is intentionally not wired here for the initial landing); the
// `touch` hook is in place so it drops in later without rippling.
// -----------------------------------------------------------------------------

import type { SessionId } from '@wanda/agent-protocol'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { ManagedSession } from './managed-session.ts'
import { touch as touchManaged } from './managed-session.ts'

export interface SessionRegistryConfig {
  readonly now?: () => number
}

export class SessionRegistry extends Context.Tag('@wanda/SessionRegistry')<
  SessionRegistry,
  {
    readonly get: (sessionId: SessionId) => Effect.Effect<ManagedSession | null>
    readonly put: (managed: ManagedSession) => Effect.Effect<void>
    readonly remove: (sessionId: SessionId) => Effect.Effect<ManagedSession | null>
    readonly touch: (sessionId: SessionId) => Effect.Effect<void>
    readonly size: Effect.Effect<number>
    readonly list: Effect.Effect<ReadonlyArray<ManagedSession>>
  }
>() {}

export function makeSessionRegistry(config: SessionRegistryConfig = {}) {
  const now = config.now ?? Date.now
  const sessions = new Map<SessionId, ManagedSession>()
  return {
    get(sessionId: SessionId): Effect.Effect<ManagedSession | null> {
      return Effect.sync(() => sessions.get(sessionId) ?? null)
    },
    put(managed: ManagedSession): Effect.Effect<void> {
      return Effect.sync(() => {
        sessions.set(managed.sessionId, managed)
      })
    },
    remove(sessionId: SessionId): Effect.Effect<ManagedSession | null> {
      return Effect.sync(() => {
        const existing = sessions.get(sessionId) ?? null
        if (existing) sessions.delete(sessionId)
        return existing
      })
    },
    touch(sessionId: SessionId): Effect.Effect<void> {
      return Effect.gen(function* () {
        const managed = sessions.get(sessionId)
        if (!managed) return
        yield* touchManaged(managed, now())
      })
    },
    size: Effect.sync(() => sessions.size),
    list: Effect.sync(() => [...sessions.values()]),
  }
}

export const SessionRegistryLive = (config?: SessionRegistryConfig): Layer.Layer<SessionRegistry> =>
  Layer.succeed(SessionRegistry, SessionRegistry.of(makeSessionRegistry(config)))
