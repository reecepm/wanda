import type { Collection } from '@tanstack/db'
import { createContext } from 'react'
import type { GitFileEntry } from '@/features/git/hooks/use-git-collection'

// Minimal context — only carries the collection + podId.
// Components subscribe to data via useLiveQuery on the collection directly,
// NOT through this context. This prevents cascading re-renders.

export interface GitManagerContextValue {
  podId: string
  collection: Collection<GitFileEntry, string>
  stageFile: (path: string) => void
  unstageFile: (path: string) => void
  selectedFile: string | null
  setSelectedFile: (path: string | null) => void
}

export interface GitContext {
  repoPath: string
  baseRef?: string
  worktreePath?: string
  worktreeBranch?: string
}

export interface PRStatus {
  number: number
  state: string
  statusCheckRollup: { state: string }[]
  mergeable: string
  headRefName: string
  baseRefName: string
  url: string
  isDraft: boolean
  title: string
  additions: number
  deletions: number
  changedFiles: number
  files: { path: string; additions: number; deletions: number }[]
}

export const GitManagerContext = createContext<GitManagerContextValue | null>(null)
