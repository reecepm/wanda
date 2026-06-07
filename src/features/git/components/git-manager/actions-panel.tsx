import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { memo, use } from 'react'
import { CommitForm } from './commit-form'
import { GitManagerContext } from './context'
import { GraphiteAwareCommitForm, GraphiteAwareSyncButtons } from './graphite-actions'
import { PRSection } from './pr-section'
import { SyncButtons } from './sync-buttons'

export const ActionsPanel = memo(function ActionsPanel() {
  const { podId, collection } = use(GitManagerContext)!

  const { data: stagedFiles = [] } = useLiveQuery(
    (q) => q.from({ f: collection }).where(({ f }) => eq(f.staged, true)),
    [collection],
  )

  return (
    <div className="border-t border-zinc-800 p-2.5 flex flex-col gap-2">
      <GraphiteAwareCommitForm
        podId={podId}
        stagedCount={stagedFiles.length}
        fallback={<CommitForm podId={podId} stagedCount={stagedFiles.length} />}
      />
      <GraphiteAwareSyncButtons podId={podId} fallback={<SyncButtons podId={podId} />} />
      <PRSection podId={podId} />
    </div>
  )
})
