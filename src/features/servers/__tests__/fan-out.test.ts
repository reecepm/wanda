// Tests for the fan-out merge helper.
//
// The hook itself wraps `useQueries` and depends on React; the merge logic
// it uses to combine N results into one is split out as a pure function so
// it can be tested without React.

import { describe, expect, it } from 'vitest'
import { mergeFanOut } from '../fan-out'

interface Pod {
  id: string
}

describe('mergeFanOut', () => {
  it('merges items from every server, attaching serverId', () => {
    const result = mergeFanOut<Pod>([
      { serverId: 'a', state: 'success', data: [{ id: 'p1' }, { id: 'p2' }] },
      { serverId: 'b', state: 'success', data: [{ id: 'p3' }] },
    ])
    expect(result.data).toEqual([
      { id: 'p1', serverId: 'a' },
      { id: 'p2', serverId: 'a' },
      { id: 'p3', serverId: 'b' },
    ])
    expect(result.isLoading).toBe(false)
    expect(result.errors).toEqual([])
    expect(result.offlineServerIds).toEqual([])
  })

  it('isLoading is true if any server is still loading', () => {
    const result = mergeFanOut<Pod>([
      { serverId: 'a', state: 'success', data: [{ id: 'p1' }] },
      { serverId: 'b', state: 'pending' },
    ])
    expect(result.isLoading).toBe(true)
    expect(result.data).toEqual([{ id: 'p1', serverId: 'a' }])
  })

  it('still surfaces successful servers when others have errored', () => {
    const result = mergeFanOut<Pod>([
      { serverId: 'a', state: 'success', data: [{ id: 'p1' }] },
      { serverId: 'b', state: 'error', error: new Error('offline') },
    ])
    expect(result.data).toEqual([{ id: 'p1', serverId: 'a' }])
    expect(result.errors.map((e) => e.serverId)).toEqual(['b'])
    expect(result.offlineServerIds).toEqual(['b'])
  })

  it('returns empty data + no errors for an empty server list', () => {
    const result = mergeFanOut<Pod>([])
    expect(result.data).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.isLoading).toBe(false)
  })

  it('treats null/undefined data as empty without crashing', () => {
    const result = mergeFanOut<Pod>([
      { serverId: 'a', state: 'success', data: null as unknown as Pod[] },
      { serverId: 'b', state: 'success', data: undefined as unknown as Pod[] },
    ])
    expect(result.data).toEqual([])
    expect(result.errors).toEqual([])
  })
})
