export type PodGitContext = {
  repoPath: string
  baseRef?: string
  source: 'auto' | 'user'
  worktreePath?: string
  worktreeBranch?: string
}
