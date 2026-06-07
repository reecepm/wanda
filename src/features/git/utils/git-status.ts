export type DiffMode = 'uncommitted' | 'branch'

export const FILE_STATUS_COLORS = {
  added: 'text-emerald-400',
  modified: 'text-amber-400',
  deleted: 'text-red-400',
  renamed: 'text-blue-400',
  untracked: 'text-zinc-500',
} as const

export const FILE_STATUS_LABELS = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: '?',
} as const

export type FileStatus = keyof typeof FILE_STATUS_LABELS
