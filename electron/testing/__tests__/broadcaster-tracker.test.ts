import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { Broadcaster } from '../../infra/broadcaster'
import { makeTestBroadcasterLayer } from '../broadcaster-tracker'

describe('makeTestBroadcasterLayer', () => {
  it('records every send() call with channel + args', async () => {
    const { layer, tracker } = makeTestBroadcasterLayer()
    const eff = Effect.gen(function* () {
      const b = yield* Broadcaster
      b.send('workenv.created', 'we_1')
      b.send('workenv.state.changed', 'we_1', 'starting', 'running')
    }).pipe(Effect.provide(layer))
    await Effect.runPromise(eff)

    expect(tracker.sends).toHaveLength(2)
    expect(tracker.sends[0]).toEqual({ channel: 'workenv.created', args: ['we_1'] })
    expect(tracker.sends[1]).toEqual({
      channel: 'workenv.state.changed',
      args: ['we_1', 'starting', 'running'],
    })
  })

  it('sendsOn(channel) filters by channel', async () => {
    const { layer, tracker } = makeTestBroadcasterLayer()
    await Effect.runPromise(
      Effect.gen(function* () {
        const b = yield* Broadcaster
        b.send('workenv.created', 'a')
        b.send('workenv.health', 'a', true)
        b.send('workenv.created', 'b')
      }).pipe(Effect.provide(layer)),
    )

    expect(tracker.sendsOn('workenv.created')).toEqual([['a'], ['b']])
    expect(tracker.sendsOn('workenv.health')).toEqual([['a', true]])
    expect(tracker.sendsOn('workenv.destroyed')).toEqual([])
  })

  it('lastOn(channel) returns the most recent matching args (or undefined)', async () => {
    const { layer, tracker } = makeTestBroadcasterLayer()
    await Effect.runPromise(
      Effect.gen(function* () {
        const b = yield* Broadcaster
        b.send('workenv.state.changed', 'x', 'stopped', 'starting')
        b.send('workenv.state.changed', 'x', 'starting', 'running')
      }).pipe(Effect.provide(layer)),
    )
    expect(tracker.lastOn('workenv.state.changed')).toEqual(['x', 'starting', 'running'])
    expect(tracker.lastOn('workenv.destroyed')).toBeUndefined()
  })

  it('clear() resets the recorded sends', async () => {
    const { layer, tracker } = makeTestBroadcasterLayer()
    await Effect.runPromise(
      Effect.gen(function* () {
        const b = yield* Broadcaster
        b.send('workenv.created', 'a')
      }).pipe(Effect.provide(layer)),
    )
    expect(tracker.sends).toHaveLength(1)
    tracker.clear()
    expect(tracker.sends).toHaveLength(0)
    expect(tracker.lastOn('workenv.created')).toBeUndefined()
  })
})
