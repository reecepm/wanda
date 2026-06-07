import { describe, expect, it } from 'vitest'
import {
  resolveBranchName,
  resolveBranchPrefix,
  resolveWorktreeDir,
} from '@/features/workspace/hooks/use-workspace-explorer'

describe('resolveBranchPrefix', () => {
  it('returns empty string for mode "none"', () => {
    expect(resolveBranchPrefix({ 'git.branchPrefix.mode': 'none' })).toBe('')
  })

  it('returns empty string when mode is missing', () => {
    expect(resolveBranchPrefix({})).toBe('')
  })

  it('returns github username for mode "github"', () => {
    expect(resolveBranchPrefix({ 'git.branchPrefix.mode': 'github', 'github.username': 'octocat' })).toBe('octocat')
  })

  it('returns empty string for github mode with no username', () => {
    expect(resolveBranchPrefix({ 'git.branchPrefix.mode': 'github' })).toBe('')
  })

  it('returns custom prefix for mode "custom"', () => {
    expect(resolveBranchPrefix({ 'git.branchPrefix.mode': 'custom', 'git.branchPrefix.custom': 'feat' })).toBe('feat')
  })
})

describe('resolveBranchName', () => {
  it('slugifies the pod name', () => {
    expect(resolveBranchName('', 'My Feature')).toBe('my-feature')
  })

  it('strips leading/trailing hyphens', () => {
    expect(resolveBranchName('', '---hello---')).toBe('hello')
  })

  it('collapses multiple non-alnum chars', () => {
    expect(resolveBranchName('', 'foo  bar__baz')).toBe('foo-bar-baz')
  })

  it('prepends prefix with slash separator', () => {
    expect(resolveBranchName('user', 'Pod 1')).toBe('user/pod-1')
  })

  it('no prefix means no slash', () => {
    expect(resolveBranchName('', 'Pod 1')).toBe('pod-1')
  })

  it('preserves slashes in pod name as path separators', () => {
    expect(resolveBranchName('', 'feat/my-pod')).toBe('feat/my-pod')
  })

  it('slugifies each segment independently when name contains slashes', () => {
    expect(resolveBranchName('', 'Foo Bar/My Feature')).toBe('foo-bar/my-feature')
  })

  it('drops empty segments from consecutive or edge slashes', () => {
    expect(resolveBranchName('', '/foo//bar/')).toBe('foo/bar')
  })

  it('combines prefix with a slash-containing pod name', () => {
    expect(resolveBranchName('user', 'feat/my-pod')).toBe('user/feat/my-pod')
  })
})

describe('resolveWorktreeDir', () => {
  const workspaceCwd = '/home/user/project'
  const workspaceName = 'My Project'
  const branchName = 'user/feature-x'

  it('resolves app-default location (explicit)', () => {
    const dir = resolveWorktreeDir('app-default', workspaceCwd, workspaceName, branchName, null, null)
    // Falls back to <cwd>/../worktrees/<ws-slug>/<branch-slug>
    expect(dir).toBe('/home/user/project/../worktrees/my-project/user-feature-x')
  })

  it('resolves app-default with global default dir', () => {
    const dir = resolveWorktreeDir('app-default', workspaceCwd, workspaceName, branchName, null, '/tmp/worktrees')
    expect(dir).toBe('/tmp/worktrees/my-project/user-feature-x')
  })

  it('resolves app-default when locationMode is undefined', () => {
    const dir = resolveWorktreeDir(undefined, workspaceCwd, workspaceName, branchName, null, null)
    expect(dir).toBe('/home/user/project/../worktrees/my-project/user-feature-x')
  })

  it('resolves alongside location', () => {
    const dir = resolveWorktreeDir('alongside', workspaceCwd, workspaceName, branchName, null, null)
    expect(dir).toBe('/home/user/project/../my-project-worktrees/user-feature-x')
  })

  it('resolves custom location', () => {
    const dir = resolveWorktreeDir('custom', workspaceCwd, workspaceName, branchName, '/custom/base/', null)
    expect(dir).toBe('/custom/base/user-feature-x')
  })

  it('custom strips trailing slashes from base dir', () => {
    const dir = resolveWorktreeDir('custom', workspaceCwd, workspaceName, branchName, '/custom/base///', null)
    expect(dir).toBe('/custom/base/user-feature-x')
  })

  it('flattens slashes in branch name to hyphens for the directory', () => {
    const dir = resolveWorktreeDir('custom', workspaceCwd, workspaceName, 'feat/a/b', '/base', null)
    expect(dir).toBe('/base/feat-a-b')
  })
})
