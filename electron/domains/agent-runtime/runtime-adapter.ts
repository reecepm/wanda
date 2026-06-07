// -----------------------------------------------------------------------------
// Wraps `@wanda/agent-runtime`'s `makeAgentRuntime` + `makeProviderRegistry`
// in Effect Live layers.
//
// Dependencies (EventLog, SubscriptionManager, providers) come from the
// server entry point — they are supplied via `configureAgentRuntimeDeps`
// before any AgentRuntime method is actually invoked. Matches the pattern
// used by `configureDatabase` and `configureBroadcaster`.
//
// The previous version threw from inside `Layer.effect(...)` if deps were
// not yet set. That failed at boot because `Layer.mergeAll` (used in
// BaseLive) materialises every child layer the first time the parent
// runtime resolves any service — so resolving `DatabaseService` inside
// `createServerRuntime` forced `AgentRuntime` to build before
// `configureAgentRuntimeDeps` had run.
//
// Fix: hand out a Proxy that lazily builds the real runtime on first
// method access. `configureAgentRuntimeDeps` can now be called any time
// before the first `AgentRuntime.<method>(...)` call, which matches how
// `configureBroadcaster` behaves.
// -----------------------------------------------------------------------------

import {
  type AgentProvider,
  AgentRuntime,
  makeAgentRuntime,
  makeProviderRegistry,
  type PendingPermissionsStore,
  type PermissionPolicyStore,
  ProviderRegistry,
  type SessionStore,
} from '@wanda/agent-runtime'
import type { EventLog } from '@wanda/event-log'
import type { SubscriptionManager } from '@wanda/subscriptions'
import { Layer } from 'effect'

interface AgentRuntimeDepsInput {
  readonly eventLog: EventLog
  readonly subscriptions: SubscriptionManager
  readonly providers: ReadonlyArray<AgentProvider>
  readonly sessionStore?: SessionStore
  readonly pendingPermissions?: PendingPermissionsStore
  readonly permissionPolicies?: PermissionPolicyStore
  readonly logger?: (message: string, ctx?: unknown) => void
}

let deps: AgentRuntimeDepsInput | null = null
let cachedRuntime: ReturnType<typeof makeAgentRuntime> | null = null
let cachedRegistry: ReturnType<typeof makeProviderRegistry> | null = null

/**
 * Supply the runtime-level dependencies. Idempotent-ish: calling twice
 * replaces the deps and invalidates the cached runtime + registry so
 * the next access rebuilds with the new values.
 */
export function configureAgentRuntimeDeps(input: AgentRuntimeDepsInput): void {
  deps = input
  cachedRuntime = null
  cachedRegistry = null
}

function resolveRuntime(): ReturnType<typeof makeAgentRuntime> {
  if (cachedRuntime) return cachedRuntime
  if (!deps) {
    throw new Error(
      'configureAgentRuntimeDeps() must be called before using AgentRuntime. ' +
        'The server entry is responsible for supplying eventLog + subscriptions + providers.',
    )
  }
  cachedRuntime = makeAgentRuntime({
    eventLog: deps.eventLog,
    subscriptions: deps.subscriptions,
    providers: deps.providers,
    sessionStore: deps.sessionStore,
    pendingPermissions: deps.pendingPermissions,
    permissionPolicies: deps.permissionPolicies,
    logger: deps.logger,
  })
  return cachedRuntime
}

function resolveRegistry(): ReturnType<typeof makeProviderRegistry> {
  if (cachedRegistry) return cachedRegistry
  if (!deps) {
    throw new Error('configureAgentRuntimeDeps() must be called before using ProviderRegistry.')
  }
  cachedRegistry = makeProviderRegistry(deps.providers)
  return cachedRegistry
}

/**
 * Lazy Proxy for the AgentRuntime service. Each property access forwards
 * to the currently-configured runtime instance. Safe to place inside an
 * eagerly-built `Layer.mergeAll` — no work happens until a method is
 * actually read.
 */
const runtimeProxy: ReturnType<typeof makeAgentRuntime> = new Proxy({} as ReturnType<typeof makeAgentRuntime>, {
  get(_target, prop, receiver) {
    return Reflect.get(resolveRuntime(), prop, receiver)
  },
  has(_target, prop) {
    return Reflect.has(resolveRuntime(), prop)
  },
  ownKeys() {
    return Reflect.ownKeys(resolveRuntime())
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(resolveRuntime(), prop)
  },
})

const registryProxy: ReturnType<typeof makeProviderRegistry> = new Proxy(
  {} as ReturnType<typeof makeProviderRegistry>,
  {
    get(_target, prop, receiver) {
      return Reflect.get(resolveRegistry(), prop, receiver)
    },
    has(_target, prop) {
      return Reflect.has(resolveRegistry(), prop)
    },
    ownKeys() {
      return Reflect.ownKeys(resolveRegistry())
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Reflect.getOwnPropertyDescriptor(resolveRegistry(), prop)
    },
  },
)

export const AgentRuntimeLive = Layer.succeed(AgentRuntime, runtimeProxy)
export const AgentProviderRegistryLive = Layer.succeed(ProviderRegistry, registryProxy)
