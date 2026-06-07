import { useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { use, useEffect, useMemo, useState } from 'react'
import { useHydrateViewedFiles } from '@/features/git/hooks/use-file-viewed'
import type { GitFileEntry } from '@/features/git/hooks/use-git-collection'
import { useGitStatus } from '@/features/git/hooks/use-git-status'
import { useDraftReview } from '@/features/git/hooks/use-review'
import { useReviewShortcuts } from '@/features/git/hooks/use-review-shortcuts'
import { useReviewStore } from '@/features/git/store/review-store'
import { splitAndParsePatch } from '@/features/git/utils/diff-utils'
import type { DiffMode } from '@/features/git/utils/git-status'
import { RiGitBranchLine, RiLoader4Line } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { DiffViewer } from './diff-viewer'
import { GitContextSelector } from './git-context-selector'
import { ActionsPanel } from './git-manager/actions-panel'
import { GitManagerContext } from './git-manager/context'
import { FileList, StagedSection, UnstagedSection, UntrackedSection } from './git-manager/file-list'
import { Header } from './git-manager/header'
import { GitManagerProvider } from './git-manager/provider'
import { StackTree } from './git-manager/stack-tree'
import { ReviewSummaryBar } from './review/summary-bar'

const SIDEBAR_WIDTH = 340

interface GitOverlayProps {
  podId: string
  onClose: () => void
}

export function GitOverlay({ podId, onClose }: GitOverlayProps) {
  return (
    <GitManagerProvider podId={podId}>
      <GitOverlayShell onClose={onClose} podId={podId} />
    </GitManagerProvider>
  )
}

function GitOverlayShell({ onClose, podId }: { onClose: () => void; podId: string }) {
  const ctx = use(GitManagerContext)!
  const { selectedFile } = ctx
  const [diffMode, setDiffMode] = useState<DiffMode>('uncommitted')
  const [baseRef, setBaseRef] = useState<string | undefined>()
  const [showContextSelector, setShowContextSelector] = useState(false)

  // Sync the active pod into the review store so review hooks can resolve it.
  // Comments are stored per pod on the server, so this scopes everything.
  const setReviewPodId = useReviewStore((s) => s.setPodId)
  useEffect(() => {
    setReviewPodId(podId)
  }, [podId, setReviewPodId])

  // Always create/fetch a draft review for the pod — keeps comment counts and
  // the summary bar accurate regardless of which diff mode the user starts in.
  useDraftReview(podId)

  const { data: status, isLoading: statusLoading } = useQuery({
    ...orpcUtils.git.getStatus.queryOptions({ input: { podId } }),
    staleTime: 5000,
  })

  const { data: diff, isLoading: diffLoading } = useQuery({
    ...orpcUtils.git.getDiff.queryOptions({ input: { podId, mode: diffMode, baseRef } }),
    staleTime: 5000,
  })

  const noRepo = !statusLoading && !status

  // Hydrate persistent viewed markers for all changed files
  const allPaths = useMemo(() => {
    const paths: string[] = []
    if (diff?.diff) {
      for (const fp of splitAndParsePatch(diff.diff)) {
        paths.push(fp.newPath || fp.oldPath)
      }
    }
    for (const p of status?.untracked ?? []) paths.push(p)
    return paths
  }, [diff, status?.untracked])
  useHydrateViewedFiles(podId, allPaths)

  // Pull the currently displayed file list out of the shared collection so j/k
  // iterates over the same set the user sees in the sidebar.
  const { data: fileEntries = [] } = useLiveQuery((q) => q.from({ f: ctx.collection }), [ctx.collection])
  useReviewShortcuts({ podId, entries: fileEntries as GitFileEntry[] })

  // Branch name for the SendToAgent prompt header. Reuses the unified status
  // subscription (ref-counted, so this doesn't double-subscribe).
  const { status: unifiedStatus } = useGitStatus(podId)
  const branch = unifiedStatus?.local.branch ?? undefined

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Comment forms / popovers handle Escape themselves and call
      // preventDefault — leave their dismiss-self behavior intact.
      if (e.defaultPrevented) return
      // Don't close when the user is typing into anything editable: blur first
      // so they can clear input/blur it without losing the whole overlay.
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          target.blur()
          return
        }
        if (target.isContentEditable) {
          target.blur()
          return
        }
      }
      onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-7">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape handled globally */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative z-10 flex flex-col w-full h-full max-w-[1400px] bg-zinc-900 border border-zinc-700/50 rounded-xl shadow-2xl overflow-hidden">
        <Header
          podId={podId}
          onClose={onClose}
          diffMode={diffMode}
          setDiffMode={setDiffMode}
          baseRef={baseRef}
          setBaseRef={setBaseRef}
          showContextSelector={showContextSelector}
          setShowContextSelector={setShowContextSelector}
        />

        {showContextSelector && <GitContextSelector podId={podId} onClose={() => setShowContextSelector(false)} />}

        {/* Review actions strip — only appears in branch mode where commenting
            is enabled. Keeps the standard header free of review chrome when
            staging uncommitted changes. */}
        {diffMode === 'branch' && !noRepo && (
          <div className="flex items-center justify-end gap-2 px-3 py-1 border-b border-zinc-800 bg-zinc-900/60 shrink-0">
            <span className="text-[10px] text-zinc-600 mr-auto">
              Click the gutter <span className="text-zinc-400">+</span> to comment · drag for multi-line
            </span>
            <ReviewSummaryBar podId={podId} branch={branch} baseBranch={baseRef} />
          </div>
        )}

        {noRepo ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <RiGitBranchLine className="h-8 w-8 text-zinc-600" />
            <p className="text-sm text-zinc-500">No git repository detected</p>
            <button
              type="button"
              onClick={() => setShowContextSelector(true)}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Set path manually
            </button>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* Staging sidebar */}
            <div style={{ width: SIDEBAR_WIDTH }} className="shrink-0 border-r border-zinc-800 flex flex-col">
              <StackTree />
              <FileList>
                <StagedSection />
                <UnstagedSection />
                <UntrackedSection />
              </FileList>
              <ActionsPanel />
            </div>

            {/* Diff content */}
            <div className="relative flex-1 min-h-0 min-w-0">
              {diffLoading ? (
                <div className="flex items-center justify-center h-full">
                  <RiLoader4Line className="h-5 w-5 text-zinc-500 animate-spin" />
                </div>
              ) : diff?.diff || (status?.untracked?.length ?? 0) > 0 ? (
                <DiffViewer
                  podId={podId}
                  diffMode={diffMode}
                  mergeBase={diff?.mergeBase}
                  diff={diff?.diff ?? ''}
                  untrackedFiles={status?.untracked}
                  selectedFile={selectedFile}
                  enableComments={diffMode === 'branch'}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-zinc-500 text-sm">No changes</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
