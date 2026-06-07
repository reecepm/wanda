import { describe, expect, it } from 'vitest'
import { resolveAgentCliArgs } from '../agent-config'

describe('resolveAgentCliArgs', () => {
  it('maps Claude permission flags through the generic flags bag', () => {
    expect(resolveAgentCliArgs('claude', { flags: { dangerouslySkipPermissions: true } })).toEqual([
      '--dangerously-skip-permissions',
    ])
  })

  it('maps known provider flags and manual args in launch order', () => {
    expect(resolveAgentCliArgs('codex', { flags: { goals: true }, extraArgs: ['--foo', 'bar'] })).toEqual([
      '--enable',
      'goals',
      '--foo',
      'bar',
    ])
  })

  it('ignores disabled flags and blank custom args', () => {
    expect(resolveAgentCliArgs('codex', { flags: { goals: false }, extraArgs: ['', '--verbose'] })).toEqual([
      '--verbose',
    ])
  })
})
