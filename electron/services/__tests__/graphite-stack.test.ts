import { describe, expect, it } from 'vitest'
import { buildGraphiteStackBranches, isMissingExecutableError } from '../graphite-stack'

describe('isMissingExecutableError', () => {
  it('only treats ENOENT-style failures as a missing gt executable', () => {
    expect(isMissingExecutableError(Object.assign(new Error('spawn gt ENOENT'), { code: 'ENOENT' }))).toBe(true)
    expect(isMissingExecutableError(Object.assign(new Error('gt exited 1'), { code: 1 }))).toBe(false)
  })
})

describe('buildGraphiteStackBranches', () => {
  it('keeps orphaned metadata branches visible instead of dropping them', () => {
    const branches = buildGraphiteStackBranches(
      [
        { branch_name: 'feature/a', parent_branch_name: 'main' },
        { branch_name: 'feature/orphan', parent_branch_name: 'missing-parent' },
        { branch_name: 'feature/orphan-child', parent_branch_name: 'feature/orphan' },
      ],
      'main',
      'feature/orphan-child',
    )

    expect(branches.map((branch) => branch.name)).toEqual([
      'main',
      'feature/a',
      'feature/orphan',
      'feature/orphan-child',
    ])
    expect(branches.find((branch) => branch.name === 'feature/orphan')).toMatchObject({
      parent: 'missing-parent',
      position: 1,
    })
    expect(branches.find((branch) => branch.name === 'feature/orphan-child')).toMatchObject({
      parent: 'feature/orphan',
      position: 2,
      isCurrent: true,
    })
  })

  it('terminates cyclic metadata and still returns each branch once', () => {
    const branches = buildGraphiteStackBranches(
      [
        { branch_name: 'feature/a', parent_branch_name: 'feature/b' },
        { branch_name: 'feature/b', parent_branch_name: 'feature/a' },
      ],
      'main',
      'feature/a',
    )

    expect(branches.map((branch) => branch.name).sort()).toEqual(['feature/a', 'feature/b', 'main'])
    expect(branches.filter((branch) => branch.name === 'feature/a')).toHaveLength(1)
    expect(branches.filter((branch) => branch.name === 'feature/b')).toHaveLength(1)
  })
})
