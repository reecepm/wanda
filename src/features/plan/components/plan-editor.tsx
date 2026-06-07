import { deserializeMd, serializeMd } from '@platejs/markdown'
import { useQuery } from '@tanstack/react-query'
import { createPlateEditor, Plate, PlateContent } from 'platejs/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FloatingToolbar, markdownComponents, markdownPlugins } from '@/features/markdown-editor'
import { RiAlertLine, RiErrorWarningLine, RiLoader4Line } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'

const AUTOSAVE_DEBOUNCE_MS = 500

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'

export function PlanEditor({ planId }: { planId: string }) {
  const { data, isLoading, error, refetch } = useQuery(orpcUtils.plan.get.queryOptions({ input: { id: planId } }))

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-zinc-500">
        <RiLoader4Line className="h-5 w-5 animate-spin" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-zinc-950 text-zinc-400">
        <RiErrorWarningLine className="h-6 w-6 text-zinc-600" />
        <p className="text-sm">Could not load plan</p>
        <p className="max-w-md text-xs text-zinc-500">{error.message}</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-zinc-950 text-zinc-500">
        <p className="text-sm">Plan not found.</p>
      </div>
    )
  }

  return (
    <PlanEditorInner
      key={planId}
      planId={planId}
      initialBody={data.body}
      initialVersion={data.version}
      onConflictResolved={() => refetch()}
    />
  )
}

interface InnerProps {
  planId: string
  initialBody: string
  initialVersion: number
  onConflictResolved: () => void
}

function PlanEditorInner({ planId, initialBody, initialVersion, onConflictResolved }: InnerProps) {
  // Plate editor created once per mount; key on the outer component flips when
  // the user navigates to a different plan, forcing a remount with fresh state.
  const editor = useMemo(() => {
    const e = createPlateEditor({
      plugins: markdownPlugins,
      components: markdownComponents,
    })
    try {
      const value = deserializeMd(e, initialBody)
      if (Array.isArray(value) && value.length > 0) {
        e.children = value
      }
    } catch (err) {
      console.error('[plan-editor] deserialize failed:', err)
      e.children = [{ type: 'p', children: [{ text: initialBody }] }]
    }
    return e
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const versionRef = useRef(initialVersion)
  const lastSavedBodyRef = useRef(initialBody)
  const pendingBodyRef = useRef(initialBody)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [conflictMessage, setConflictMessage] = useState<string | null>(null)

  const doSave = useCallback(
    async (body: string) => {
      if (body === lastSavedBodyRef.current) {
        setStatus('idle')
        return
      }
      setStatus('saving')
      try {
        const updated = await orpcUtils.plan.update.call({
          id: planId,
          expectedVersion: versionRef.current,
          body,
        })
        versionRef.current = updated.version
        lastSavedBodyRef.current = body
        setStatus('saved')
      } catch (err) {
        // The only expected mutation error is a version conflict (whole-doc
        // optimistic locking). Treat any error as a conflict prompt — the
        // user can reload to recover.
        const message = err instanceof Error ? err.message : String(err)
        console.error('[plan-editor] save failed:', message)
        setConflictMessage('This plan was changed elsewhere. Reload to see the latest version.')
        setStatus('conflict')
      }
    },
    [planId],
  )

  const scheduleAutosave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      void doSave(pendingBodyRef.current)
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [doSave])

  const handleChange = useCallback(() => {
    let serialized: string
    try {
      serialized = serializeMd(editor)
    } catch (err) {
      console.error('[plan-editor] serialize failed:', err)
      return
    }
    pendingBodyRef.current = serialized
    if (serialized === lastSavedBodyRef.current) {
      setStatus('idle')
      return
    }
    if (status === 'conflict') return // don't overwrite during conflict
    setStatus('dirty')
    scheduleAutosave()
  }, [editor, scheduleAutosave, status])

  const handleReloadFromServer = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    try {
      const fresh = await orpcUtils.plan.get.call({ id: planId })
      if (!fresh) return
      const value = deserializeMd(editor, fresh.body)
      if (Array.isArray(value) && value.length > 0) {
        editor.tf.setValue(value)
      }
      versionRef.current = fresh.version
      lastSavedBodyRef.current = fresh.body
      pendingBodyRef.current = fresh.body
      setConflictMessage(null)
      setStatus('idle')
      onConflictResolved()
    } catch (err) {
      console.error('[plan-editor] reload failed:', err)
    }
  }, [editor, planId, onConflictResolved])

  // Force-save on Cmd/Ctrl+S.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (debounceRef.current) {
          clearTimeout(debounceRef.current)
          debounceRef.current = null
        }
        void doSave(pendingBodyRef.current)
      }
    },
    [doSave],
  )

  // Best-effort flush on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      const current = pendingBodyRef.current
      if (current !== lastSavedBodyRef.current && status !== 'conflict') {
        void orpcUtils.plan.update
          .call({ id: planId, expectedVersion: versionRef.current, body: current })
          .catch((err) => console.error('[plan-editor] unmount save failed:', err))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <PlanSaveStatusBar status={status} />
      {conflictMessage && (
        <div className="flex items-center gap-3 border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-xs text-amber-200">
          <RiAlertLine className="h-4 w-4 shrink-0" />
          <span className="flex-1">{conflictMessage}</span>
          <Button variant="outline" size="sm" onClick={handleReloadFromServer}>
            Reload
          </Button>
        </div>
      )}
      <div className="canvas-scrollable min-h-0 flex-1 overflow-auto">
        <Plate editor={editor} onChange={handleChange}>
          <FloatingToolbar editorId={editor.id} />
          <PlateContent
            onKeyDown={handleKeyDown}
            placeholder="Start writing… Use / for commands, # for headings."
            className="mx-auto min-h-full max-w-3xl px-8 py-6 text-sm text-zinc-200 outline-none [&_.slate-placeholder]:text-zinc-600"
          />
        </Plate>
      </div>
    </div>
  )
}

function PlanSaveStatusBar({ status }: { status: SaveStatus }) {
  let label = ''
  let color = 'text-zinc-600'
  if (status === 'saving') {
    label = 'Saving…'
    color = 'text-zinc-400'
  } else if (status === 'dirty') {
    label = 'Unsaved'
    color = 'text-zinc-400'
  } else if (status === 'saved') {
    label = 'Saved'
    color = 'text-zinc-500'
  } else if (status === 'conflict') {
    label = 'Conflict'
    color = 'text-amber-400'
  } else if (status === 'error') {
    label = 'Save failed'
    color = 'text-red-400'
  }
  return (
    <div className="flex h-6 shrink-0 items-center justify-end border-b border-zinc-800 bg-zinc-900 px-3 text-[11px]">
      <span className={color}>{label}</span>
    </div>
  )
}
