// -----------------------------------------------------------------------------
// @wanda/subscriptions — typed per-resource fan-out registry for the gateway.
// -----------------------------------------------------------------------------

export { SubscriptionManager } from './subscription-manager.ts'
export type {
  Connection,
  ConnectionRegistration,
  PublishResult,
  Subscription,
  SubscriptionKind,
  SubscriptionManagerConfig,
} from './types.ts'
export { isSubscriptionKind, SUBSCRIPTION_KINDS } from './types.ts'
