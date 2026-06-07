import { deserializeMd, serializeMd } from '@platejs/markdown'
import { createPlateEditor, Plate, PlateContent } from 'platejs/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePodItem } from '@/features/view'
import { RiErrorWarningLine, RiLoader4Line } from '@/lib/icons'
import { ConflictDialog } from './conflict-dialog'
import { FloatingToolbar } from './floating-toolbar'
import { markdownComponents, markdownPlugins } from './plugins'
import { useMarkdownFile } from './use-markdown-file'

const AUTOSAVE_DEBOUNCE_MS = 500

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

interface MarkdownEditorContentProps {
  itemId: string
  filePath: string
}

/**
 * Outer wrapper — handles the initial load + error / loading states. Creates
 * the inner editor only after content has arrived, so we never have to
 * imperatively set the editor value.
 */
export const MarkdownEditorContent = memo(function MarkdownEditorContent({
  itemId,
  filePath,
}: MarkdownEditorContentProps) {
  const item = usePodItem(itemId)
  const podId = item?.podId ?? null

  if (!podId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-zinc-950 text-center text-zinc-500">
        <RiErrorWarningLine className="h-6 w-6 text-zinc-600" />
        <p className="text-sm">Markdown items must be attached to a pod.</p>
      </div>
    )
  }

  return <MarkdownEditorContentWithPod podId={podId} filePath={filePath} />
})

function MarkdownEditorContentWithPod({ podId, filePath }: { podId: string; filePath: string }) {
  const file = useMarkdownFile(podId, filePath)

  if (file.isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-zinc-500">
        <RiLoader4Line className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (file.error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-zinc-950 px-8 text-center text-zinc-400">
        <RiErrorWarningLine className="h-8 w-8 text-zinc-600" />
        <p className="text-sm">Could not open file</p>
        <p className="font-mono text-xs text-zinc-500">{filePath}</p>
        <p className="max-w-md text-xs text-zinc-500">{file.error.message}</p>
      </div>
    )
  }

  if (file.initialContent === null) return null

  return (
    <MarkdownEditorInner
      key={`${podId}:${filePath}`}
      fileName={filePath}
      initialContent={file.initialContent}
      hasExternalChange={file.hasExternalChange}
      save={file.save}
      reload={file.reload}
      clearExternalChange={file.clearExternalChange}
    />
  )
}

interface MarkdownEditorInnerProps {
  fileName: string
  initialContent: string
  hasExternalChange: boolean
  save: (content: string) => Promise<number>
  reload: () => Promise<string>
  clearExternalChange: () => void
}

function MarkdownEditorInner({
  fileName,
  initialContent,
  hasExternalChange,
  save,
  reload,
  clearExternalChange,
}: MarkdownEditorInnerProps) {
  // Create the editor once with the initial content deserialized from markdown.
  const editor = useMemo(() => {
    const e = createPlateEditor({
      plugins: markdownPlugins,
      components: markdownComponents,
    })
    try {
      const value = deserializeMd(e, initialContent)
      if (Array.isArray(value) && value.length > 0) {
        e.children = value
      }
    } catch (err) {
      console.error('[markdown-editor] deserialize failed:', err)
      // Fall back to a single empty paragraph.
      e.children = [{ type: 'p', children: [{ text: initialContent }] }]
    }
    return e
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [conflictOpen, setConflictOpen] = useState(false)
  // The last content we persisted (or the initial content, which is effectively "saved").
  const lastSavedContentRef = useRef(initialContent)
  // Content snapshot from the most recent edit — used when the user is prompted for a save conflict.
  const pendingContentRef = useRef(initialContent)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasEditedRef = useRef(false)

  const doSave = useCallback(
    async (content: string) => {
      if (content === lastSavedContentRef.current) {
        setSaveStatus('idle')
        return
      }
      setSaveStatus('saving')
      try {
        await save(content)
        lastSavedContentRef.current = content
        setSaveStatus('saved')
      } catch (err) {
        console.error('[markdown-editor] save failed:', err)
        setSaveStatus('error')
      }
    },
    [save],
  )

  const flushSave = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    const current = pendingContentRef.current
    if (current === lastSavedContentRef.current) return
    if (hasExternalChange) {
      setConflictOpen(true)
      return
    }
    await doSave(current)
  }, [doSave, hasExternalChange])

  const scheduleAutosave = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      // If there's an external change, don't silently overwrite — surface the prompt instead.
      if (hasExternalChange) {
        setConflictOpen(true)
        return
      }
      void doSave(pendingContentRef.current)
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [doSave, hasExternalChange])

  const handleChange = useCallback(() => {
    if (!hasEditedRef.current) {
      hasEditedRef.current = true
    }
    let serialized: string
    try {
      serialized = serializeMd(editor)
    } catch (err) {
      console.error('[markdown-editor] serialize failed:', err)
      return
    }
    pendingContentRef.current = serialized
    if (serialized === lastSavedContentRef.current) {
      setSaveStatus('idle')
      return
    }
    setSaveStatus('dirty')
    scheduleAutosave()
  }, [editor, scheduleAutosave])

  // Auto-reload on external change when clean (no pending edits).
  useEffect(() => {
    if (!hasExternalChange) return
    const isDirty = pendingContentRef.current !== lastSavedContentRef.current
    if (isDirty) return // caller will handle via conflict dialog
    void reload().then((content) => {
      try {
        const value = deserializeMd(editor, content)
        if (Array.isArray(value) && value.length > 0) {
          editor.tf.setValue(value)
        }
        lastSavedContentRef.current = content
        pendingContentRef.current = content
        setSaveStatus('idle')
      } catch (err) {
        console.error('[markdown-editor] external reload deserialize failed:', err)
      }
    })
  }, [hasExternalChange, reload, editor])

  // Flush on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      // Best effort: if there are unsaved edits and no conflict, persist them.
      const current = pendingContentRef.current
      if (current !== lastSavedContentRef.current && !hasExternalChange) {
        void save(current).catch((err) => console.error('[markdown-editor] unmount save failed:', err))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cmd+S / Ctrl+S — force immediate save.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void flushSave()
      }
    },
    [flushSave],
  )

  const handleKeepMine = useCallback(() => {
    setConflictOpen(false)
    clearExternalChange()
    void doSave(pendingContentRef.current)
  }, [clearExternalChange, doSave])

  const handleDiscardMine = useCallback(() => {
    setConflictOpen(false)
    void reload().then((content) => {
      try {
        const value = deserializeMd(editor, content)
        if (Array.isArray(value) && value.length > 0) {
          editor.tf.setValue(value)
        }
        lastSavedContentRef.current = content
        pendingContentRef.current = content
        setSaveStatus('idle')
      } catch (err) {
        console.error('[markdown-editor] discard reload deserialize failed:', err)
      }
    })
  }, [editor, reload])

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <StatusBar
        fileName={fileName}
        status={saveStatus}
        hasExternalChange={hasExternalChange}
        isDirty={pendingContentRef.current !== lastSavedContentRef.current}
      />
      <div className="canvas-scrollable min-h-0 flex-1 overflow-auto">
        <Plate editor={editor} onChange={handleChange}>
          <FloatingToolbar editorId={editor.id} />
          <PlateContent
            onKeyDown={handleKeyDown}
            placeholder="Start typing… Use / for commands, # for headings, **bold**, *italic*"
            className="mx-auto min-h-full max-w-3xl px-8 py-6 text-sm text-zinc-200 outline-none [&_.slate-placeholder]:text-zinc-600"
          />
        </Plate>
      </div>
      <ConflictDialog
        open={conflictOpen}
        fileName={fileName}
        onKeepMine={handleKeepMine}
        onDiscardMine={handleDiscardMine}
        onOpenChange={setConflictOpen}
      />
    </div>
  )
}

interface StatusBarProps {
  fileName: string
  status: SaveStatus
  hasExternalChange: boolean
  isDirty: boolean
}

function StatusBar({ fileName, status, hasExternalChange, isDirty }: StatusBarProps) {
  let statusLabel: string
  let statusColor: string
  if (hasExternalChange && isDirty) {
    statusLabel = 'File changed on disk'
    statusColor = 'text-amber-400'
  } else if (status === 'saving') {
    statusLabel = 'Saving…'
    statusColor = 'text-zinc-400'
  } else if (status === 'error') {
    statusLabel = 'Save failed'
    statusColor = 'text-red-400'
  } else if (status === 'dirty') {
    statusLabel = 'Unsaved'
    statusColor = 'text-zinc-400'
  } else if (status === 'saved') {
    statusLabel = 'Saved'
    statusColor = 'text-zinc-500'
  } else {
    statusLabel = ''
    statusColor = 'text-zinc-600'
  }

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 text-[11px]">
      <span className="truncate font-mono text-zinc-400">{fileName}</span>
      <span className={statusColor}>{statusLabel}</span>
    </div>
  )
}
