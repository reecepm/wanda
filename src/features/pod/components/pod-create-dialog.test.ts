import { describe, expect, it } from 'vitest'
import { resolveBranchName, resolveWorktreeDir } from '@/features/workspace'
import type { PodCreateData, WorktreeConfig } from './pod-create-dialog'

/**
 * Tests the worktree data assembly logic that the PodCreateDialog uses.
 * This verifies the same computation the dialog's handleSubmit performs:
 * given a WorktreeConfig and pod name, produce the correct PodCreateData.worktree.
 */

function buildWorktreeData(config: WorktreeConfig, podName: string): PodCreateData['worktree'] | undefined {
  if (!config.enabled || !podName.trim()) return undefined

  const branchName = resolveBranchName(config.branchPrefix, podName.trim())
  const directory = resolveWorktreeDir(
    config.locationMode,
    config.workspaceCwd,
    config.workspaceName,
    branchName,
    config.worktreeBaseDir,
    config.globalDefaultDir,
  )

  return {
    repoPath: config.repoPath,
    branchName,
    directory,
    branchFrom: config.branchFrom || undefined,
    baseFromRemote: config.baseFromRemote,
    copyHiddenFiles: config.copyHiddenFiles || undefined,
    sourceDir: config.copyHiddenFiles ? config.workspaceCwd : undefined,
  }
}

const baseConfig: WorktreeConfig = {
  enabled: true,
  repoPath: '/home/user/project',
  workspaceName: 'My Project',
  workspaceCwd: '/home/user/project',
  locationMode: 'app-default',
  worktreeBaseDir: null,
  branchFrom: null,
  copyHiddenFiles: false,
  branchPrefix: '',
  globalDefaultDir: null,
}

describe('worktree data assembly', () => {
  it('produces correct worktree data for basic config', () => {
    const result = buildWorktreeData(baseConfig, 'Feature A')
    expect(result).toEqual({
      repoPath: '/home/user/project',
      branchName: 'feature-a',
      directory: '/home/user/project/../worktrees/my-project/feature-a',
      branchFrom: undefined,
      baseFromRemote: undefined,
      copyHiddenFiles: undefined,
      sourceDir: undefined,
    })
  })

  it('returns undefined when worktree is disabled', () => {
    expect(buildWorktreeData({ ...baseConfig, enabled: false }, 'Test')).toBeUndefined()
  })

  it('returns undefined when pod name is empty', () => {
    expect(buildWorktreeData(baseConfig, '')).toBeUndefined()
    expect(buildWorktreeData(baseConfig, '   ')).toBeUndefined()
  })

  it('includes branchFrom when set', () => {
    const config = { ...baseConfig, branchFrom: 'develop' }
    const result = buildWorktreeData(config, 'Hotfix')
    expect(result?.branchFrom).toBe('develop')
  })

  it('includes copyHiddenFiles and sourceDir when enabled', () => {
    const config = { ...baseConfig, copyHiddenFiles: true }
    const result = buildWorktreeData(config, 'Test')
    expect(result?.copyHiddenFiles).toBe(true)
    expect(result?.sourceDir).toBe('/home/user/project')
  })

  it('applies branch prefix', () => {
    const config = { ...baseConfig, branchPrefix: 'user' }
    const result = buildWorktreeData(config, 'Pod 1')
    expect(result?.branchName).toBe('user/pod-1')
    // Branch slug uses hyphens for slashes in directory
    expect(result?.directory).toContain('user-pod-1')
  })

  it('uses custom worktree base dir', () => {
    const config = { ...baseConfig, locationMode: 'custom' as const, worktreeBaseDir: '/tmp/trees' }
    const result = buildWorktreeData(config, 'Test Pod')
    expect(result?.directory).toBe('/tmp/trees/test-pod')
  })

  it('uses workspace cwd as repoPath when repoPath equals cwd (fallback scenario)', () => {
    // This simulates the case where workspace was created in directory mode
    // and repoPath was not explicitly set — we fall back to cwd
    const config = { ...baseConfig, repoPath: '/home/user/project' }
    const result = buildWorktreeData(config, 'Test')
    expect(result?.repoPath).toBe('/home/user/project')
  })

  it('uses alongside location mode', () => {
    const config = { ...baseConfig, locationMode: 'alongside' as const }
    const result = buildWorktreeData(config, 'Dev')
    expect(result?.directory).toBe('/home/user/project/../my-project-worktrees/dev')
  })
})
