import { use, useEffect } from 'react'
import { GitManagerContext } from '@/features/git/components/git-manager/context'
import { useToggleFileViewed } from '@/features/git/hooks/use-file-viewed'
import type { GitFileEntry } from '@/features/git/hooks/use-git-collection'
import { useViewedFilesStore } from '@/features/git/store/viewed-files-store'

interface Options {
  podId: string
  /** Files visible in the file list, in display order. j/k iterates this list. */
  entries: GitFileEntry[]
  /** Imperatively focus an external file-filter input (bound to "/"). */
  focusFilter?: () => void
}

/**
 * Review-mode keyboard shortcuts inside the git overlay. Single unmodified
 * keys, scoped to fire only when focus is outside any input/textarea/
 * contenteditable.
 *
 * - j/k      — next / previous file
 * - .        — toggle viewed on current file, jump to next unviewed
 * - /        — focus the file filter input (if provided)
 * - a        — clear file selection ("All files")
 */
export function useReviewShortcuts({ podId, entries, focusFilter }: Options) {
  const ctx = use(GitManagerContext)!
  const toggleViewed = useToggleFileViewed(podId)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target.isContentEditable) return
      }

      const key = e.key
      if (key !== 'j' && key !== 'k' && key !== '.' && key !== '/' && key !== 'a') return

      const { selectedFile, setSelectedFile } = ctx

      if (key === '/') {
        if (!focusFilter) return
        e.preventDefault()
        focusFilter()
        return
      }
      if (key === 'a') {
        e.preventDefault()
        setSelectedFile(null)
        return
      }

      if (entries.length === 0) return
      const currentIdx = selectedFile ? entries.findIndex((en) => en.path === selectedFile) : -1

      if (key === 'j') {
        e.preventDefault()
        const next = currentIdx < entries.length - 1 ? currentIdx + 1 : 0
        const entry = entries[next]
        if (entry) setSelectedFile(entry.path)
        return
      }
      if (key === 'k') {
        e.preventDefault()
        const prev = currentIdx > 0 ? currentIdx - 1 : entries.length - 1
        const entry = entries[prev]
        if (entry) setSelectedFile(entry.path)
        return
      }
      if (key === '.') {
        e.preventDefault()
        if (selectedFile == null) return
        toggleViewed(selectedFile)
        queueMicrotask(() => {
          const { viewed } = useViewedFilesStore.getState()
          const startIdx = entries.findIndex((en) => en.path === selectedFile)
          for (let i = 1; i <= entries.length; i++) {
            const candidate = entries[(startIdx + i) % entries.length]
            if (candidate && !viewed.has(`${podId}:${candidate.path}`)) {
              ctx.setSelectedFile(candidate.path)
              return
            }
          }
          ctx.setSelectedFile(null)
        })
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [podId, entries, focusFilter, toggleViewed, ctx])
}
