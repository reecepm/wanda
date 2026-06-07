import { describe, expect, it } from 'vitest'
import { EVENT_CHANNELS, eventResourceKind, isEventChannel } from '../contracts/events.ts'
import { RESOURCE_KINDS } from '../contracts/resources.ts'

describe('events', () => {
  it('EVENT_CHANNELS is non-empty', () => {
    expect(EVENT_CHANNELS.length).toBeGreaterThan(0)
  })

  it('every channel starts with event:', () => {
    for (const c of EVENT_CHANNELS) {
      expect(c.startsWith('event:')).toBe(true)
    }
  })

  it('every channel resolves to a known resource kind', () => {
    const kinds = new Set<string>(RESOURCE_KINDS)
    for (const c of EVENT_CHANNELS) {
      expect(kinds.has(eventResourceKind(c))).toBe(true)
    }
  })

  it('isEventChannel only accepts listed channels', () => {
    expect(isEventChannel('event:pod:created')).toBe(true)
    expect(isEventChannel('event:pod:nope')).toBe(false)
    expect(isEventChannel('sys:hello')).toBe(false)
  })

  it('covers at least created/updated/deleted for pod and workspace', () => {
    const required = [
      'event:pod:created',
      'event:pod:updated',
      'event:pod:deleted',
      'event:workspace:created',
      'event:workspace:updated',
      'event:workspace:deleted',
    ] as const
    const set = new Set<string>(EVENT_CHANNELS)
    for (const r of required) expect(set.has(r)).toBe(true)
  })
})
