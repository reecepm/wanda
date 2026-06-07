// -----------------------------------------------------------------------------
// Typed event channel namespace.
//
// This file owns the *list* of channels the wire protocol supports. Payload
// schemas live in the packages that produce/consume them (client-store writes
// appliers, event-log writes publishers). The list itself is here so:
//   - adding a new channel is a compile-time change visible to every package,
//   - router and subscription code can exhaustively switch on EventChannel,
//   - the envelope decoder can reject unknown `event:*` channels early.
//
// System (sys:*) and terminal (terminal:*) channels have their own modules.
// -----------------------------------------------------------------------------

import type { ResourceKind } from './resources.ts'

// Tuple kept flat so the discriminated union is trivially exhaustive.
export const EVENT_CHANNELS = [
  'event:pod:created',
  'event:pod:updated',
  'event:pod:deleted',
  'event:workspace:created',
  'event:workspace:updated',
  'event:workspace:deleted',
  'event:podItem:created',
  'event:podItem:updated',
  'event:podItem:deleted',
  'event:view:created',
  'event:view:updated',
  'event:view:deleted',
  'event:agent:created',
  'event:agent:updated',
  'event:agent:deleted',
  'event:agentSession:event',
  'event:command:created',
  'event:command:updated',
  'event:command:deleted',
  'event:port:created',
  'event:port:updated',
  'event:port:deleted',
  'event:terminal:created',
  'event:terminal:destroyed',
] as const

export type EventChannel = (typeof EVENT_CHANNELS)[number]

const EVENT_CHANNEL_SET = new Set<string>(EVENT_CHANNELS)

export function isEventChannel(value: string): value is EventChannel {
  return EVENT_CHANNEL_SET.has(value)
}

/**
 * Parse `event:<kind>:<action>` → resource kind. Returns null for unknown.
 * Central so the subscription manager can index events by `(kind, scope)`
 * without every call-site reimplementing the split.
 */
export function eventResourceKind(channel: EventChannel): ResourceKind {
  const parts = channel.split(':')
  // channels in this file are authored here and always have 3 parts; the
  // cast is safe because `EventChannel` constrains `channel`.
  return parts[1] as ResourceKind
}
