// Pure helpers for worktree branch/dir resolution. Shared by the sidebar
// quick-create path and the pod-create dialog — no React, fully unit-tested.

export const GIT_SETTINGS_KEYS = [
  'git.branchPrefix.mode',
  'git.branchPrefix.custom',
  'git.defaultWorktreesDir',
  'git.worktreeCleanup',
  'github.username',
] as const

export function resolveBranchPrefix(gitSettings: Record<string, string | null | undefined>): string {
  const mode = gitSettings['git.branchPrefix.mode'] ?? 'none'
  if (mode === 'github') return gitSettings['github.username'] ?? ''
  if (mode === 'custom') return gitSettings['git.branchPrefix.custom'] ?? ''
  return ''
}

export function resolveBranchName(prefix: string, podName: string): string {
  const slug = podName
    .toLowerCase()
    .split('/')
    .map((seg) => seg.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean)
    .join('/')
  return prefix ? `${prefix}/${slug}` : slug
}

export function resolveWorktreeDir(
  locationMode: string | null | undefined,
  workspaceCwd: string,
  workspaceName: string,
  branchName: string,
  worktreeBaseDir: string | null | undefined,
  globalDefaultDir: string | null | undefined,
): string {
  const slug = branchName.replace(/\//g, '-')
  switch (locationMode) {
    case 'alongside': {
      const wsSlug = workspaceName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      return `${workspaceCwd}/../${wsSlug}-worktrees/${slug}`
    }
    case 'custom':
      return `${(worktreeBaseDir ?? '').replace(/\/+$/, '')}/${slug}`
    default: {
      const baseDir = globalDefaultDir ?? `${workspaceCwd}/../worktrees`
      const wsSlug = workspaceName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      return `${baseDir.replace(/\/+$/, '')}/${wsSlug}/${slug}`
    }
  }
}
