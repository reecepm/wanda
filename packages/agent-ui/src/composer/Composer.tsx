// -----------------------------------------------------------------------------
// Composer — the prompt input surface.
//
// Surfaces a textarea, attachment tray, and a pill toolbar in a single
// bordered container. Enter submits (Shift+Enter inserts newline). Attachments
// upload optimistically and show per-item status chips. Submit is disabled
// until every pending upload has settled.
// -----------------------------------------------------------------------------

import type { ModeId, ModelId, PromptBlock, ReasoningEffort, SessionId } from '@wanda/agent-protocol'
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '../cn'
import type { AttachmentUploadResult } from '../context'
import { useAgentTransport, useChatStore } from '../context'
import { useAgentSession } from '../hooks/useAgentMessages'
import { IconButton } from '../ui/IconButton'
import { IconArrowUp, IconPaperclip, IconStop, IconX } from '../ui/icons'
import { Kbd } from '../ui/Kbd'
import { Select, type SelectOption } from '../ui/Select'

interface PendingAttachment {
  readonly localId: string
  readonly name: string
  readonly mediaType: string
  readonly previewUrl: string | null
  uploaded: AttachmentUploadResult | null
  error: string | null
}

export function Composer({
  sessionId,
  className,
  placeholder = 'Ask the agent…',
  extraToolbarLeft,
  extraToolbarRight,
}: {
  sessionId: SessionId
  className?: string
  placeholder?: string
  /** Injected into the composer toolbar (left side, after attachment button). */
  extraToolbarLeft?: ReactNode
  /** Injected into the toolbar (right side, before send button). */
  extraToolbarRight?: ReactNode
}) {
  const transport = useAgentTransport()
  const store = useChatStore(sessionId)
  const session = useAgentSession(sessionId)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<ReadonlyArray<PendingAttachment>>([])
  const [focused, setFocused] = useState(false)
  const [dragHot, setDragHot] = useState(false)
  const seqRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const attachmentsEnabled = typeof transport.uploadAttachment === 'function'
  const hasSettled = (a: PendingAttachment) => a.uploaded != null && a.error == null
  const allUploadsSettled = attachments.every(hasSettled)

  const running = session.status === 'running'
  const closed = session.status === 'closed'
  const readyForInput = session.status === 'ready'

  const canSubmit =
    !busy &&
    readyForInput &&
    allUploadsSettled &&
    (value.trim().length > 0 || attachments.some(hasSettled)) &&
    !running &&
    !closed

  const revokePreview = (a: PendingAttachment): void => {
    if (a.previewUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      try {
        URL.revokeObjectURL(a.previewUrl)
      } catch {
        /* ignore */
      }
    }
  }

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.localId === localId)
      if (target) revokePreview(target)
      return prev.filter((a) => a.localId !== localId)
    })
  }, [])

  const uploadFile = useCallback(
    async (file: File): Promise<void> => {
      if (!transport.uploadAttachment) return
      const localId = `pa_${seqRef.current++}_${Date.now().toString(36)}`
      const isImage = file.type.startsWith('image/')
      const previewUrl = isImage && typeof URL !== 'undefined' ? URL.createObjectURL(file) : null
      setAttachments((prev) => [
        ...prev,
        {
          localId,
          name: file.name,
          mediaType: file.type || 'application/octet-stream',
          previewUrl,
          uploaded: null,
          error: null,
        },
      ])
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const result = await transport.uploadAttachment({
          bytes,
          mediaType: file.type || 'application/octet-stream',
          name: file.name || undefined,
          sessionId,
        })
        setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, uploaded: result } : a)))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, error: message } : a)))
      }
    },
    [transport, sessionId],
  )

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      if (!attachmentsEnabled) return
      const items = e.clipboardData?.items
      if (!items || items.length === 0) return
      const files: File[] = []
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length === 0) return
      e.preventDefault()
      for (const file of files) void uploadFile(file)
    },
    [attachmentsEnabled, uploadFile],
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      setDragHot(false)
      if (!attachmentsEnabled) return
      if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return
      e.preventDefault()
      for (const file of e.dataTransfer.files) void uploadFile(file)
    },
    [attachmentsEnabled, uploadFile],
  )

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!attachmentsEnabled) return
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
        setDragHot(true)
      }
    },
    [attachmentsEnabled],
  )

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget === e.target) setDragHot(false)
  }, [])

  const handleFilePick = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return
      for (const f of files) void uploadFile(f)
      e.target.value = ''
    },
    [uploadFile],
  )

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const text = value.trim()
    const attached = attachments.filter(hasSettled)
    const snapshot = attachments
    setValue('')
    setAttachments([])
    try {
      const blocks: PromptBlock[] = []
      if (text.length > 0) blocks.push({ kind: 'text', text })
      for (const a of attached) {
        if (!a.uploaded) continue
        const isImage = a.uploaded.mediaType.startsWith('image/')
        if (isImage) {
          blocks.push({
            kind: 'image',
            id: a.uploaded.id,
            mediaType: a.uploaded.mediaType,
            size: a.uploaded.size,
            sha256: a.uploaded.sha256,
            name: a.uploaded.name ?? undefined,
          })
        } else {
          blocks.push({
            kind: 'attachment',
            id: a.uploaded.id,
            mediaType: a.uploaded.mediaType,
            size: a.uploaded.size,
            sha256: a.uploaded.sha256,
            name: a.uploaded.name ?? undefined,
          })
        }
      }
      const optimisticId = store.startOptimisticUserMessage(blocks)
      try {
        const result = await transport.prompt({ sessionId, content: blocks })
        if (optimisticId) {
          store.bindOptimisticUserTurn(result.turnId)
        }
      } catch (err) {
        if (optimisticId) store.clearOptimisticUserMessage()
        throw err
      }
      for (const a of snapshot) revokePreview(a)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setValue(text)
      setAttachments(snapshot)
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // React exposes the IME-composing flag on the native event, not the
    // synthetic one. Skip Enter while the user is composing (e.g. with an
    // IME) so the keystroke commits the character rather than submitting.
    const composing = (e.nativeEvent as { isComposing?: boolean }).isComposing
    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      e.preventDefault()
      void submit()
    }
  }

  // Auto-resize the textarea to content, up to a comfortable max.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    const next = Math.min(el.scrollHeight, 240)
    el.style.height = `${Math.max(next, 40)}px`
  }, [value])

  const disabledReason = closed ? 'Session closed' : session.status === 'starting' ? 'Connecting to agent…' : null

  return (
    <form onSubmit={submit} className={cn('relative', className)}>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'relative rounded-2xl border-[0.5px] border-border bg-background/80 backdrop-blur',
          'transition-[border-color,box-shadow] duration-150',
          focused && 'border-foreground/25 shadow-[0_1px_0_0_var(--color-border)]',
          dragHot && 'border-foreground/50 ring-2 ring-foreground/10',
          closed && 'opacity-60',
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b-[0.5px] border-border/60 px-2.5 pt-2">
            {attachments.map((a) => (
              <AttachmentChip key={a.localId} attachment={a} onRemove={() => removeAttachment(a.localId)} />
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          disabled={closed}
          placeholder={disabledReason ?? placeholder}
          rows={1}
          className={cn(
            'block w-full resize-none bg-transparent px-3.5 pt-3 pb-1',
            'text-[13px] leading-[1.55] text-foreground placeholder:text-muted-foreground',
            'focus-visible:outline-none',
            'disabled:cursor-not-allowed',
          )}
        />
        <div className="flex items-center gap-1.5 px-2 pb-2 pt-0.5">
          {attachmentsEnabled && (
            <>
              <input ref={fileInputRef} type="file" multiple onChange={handleFilePick} className="hidden" />
              <IconButton
                variant="ghost"
                size="md"
                icon={<IconPaperclip />}
                label="Attach files"
                onClick={() => fileInputRef.current?.click()}
              />
            </>
          )}
          {extraToolbarLeft}
          <div className="ml-auto flex items-center gap-2">
            {extraToolbarRight}
            {running ? (
              <IconButton
                variant="danger"
                size="lg"
                icon={<IconStop />}
                label="Stop"
                onClick={() => transport.cancel({ sessionId })}
              />
            ) : (
              <IconButton
                type="submit"
                variant="solid"
                size="lg"
                disabled={!canSubmit}
                icon={<IconArrowUp />}
                label="Send"
              />
            )}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between px-1 text-[10.5px] text-muted-foreground/80">
        <span>
          {closed ? (
            'Session closed'
          ) : running ? (
            <span className="flex items-center gap-1.5">
              <span className="relative inline-block h-1.5 w-1.5 align-middle">
                <span className="absolute inset-0 rounded-full bg-foreground/40 [animation:agent-dot-ping_1.2s_ease-in-out_infinite]" />
                <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-foreground/70" />
              </span>
              Working · Stop to interrupt
            </span>
          ) : session.status === 'starting' ? (
            'Connecting to agent…'
          ) : (
            <span>
              <Kbd>⏎</Kbd> send · <Kbd>⇧⏎</Kbd> newline
              {attachmentsEnabled ? ' · drop files to attach' : ''}
            </span>
          )}
        </span>
        {error && <span className="truncate text-destructive">{error}</span>}
      </div>
    </form>
  )
}

export function ComposerModePicker({ sessionId }: { sessionId: SessionId }) {
  const session = useAgentSession(sessionId)
  const transport = useAgentTransport()
  const [pending, setPending] = useState(false)

  if (session.modes.length === 0 || !transport.setMode) return null

  // No synthetic "Auto" option: the mode list is the provider's full
  // expression of permission policy. Adding a null "Auto" produced an
  // inert third entry (Codex shows Default Permissions / Full Access;
  // clicking "Auto" was a silent no-op). If a provider ever wants a
  // true "unset" state it should advertise it explicitly in `modes`.
  const options: SelectOption<string>[] = session.modes.map((m) => ({
    id: m.id as unknown as string,
    label: m.label,
    description: m.description,
  }))

  const disabled = pending || session.status !== 'ready'
  return (
    <Select
      label="mode"
      value={session.currentModeId as unknown as string | null}
      options={options}
      disabled={disabled}
      onChange={async (next) => {
        if (!transport.setMode || next === null) return
        const nextId = next as unknown as ModeId
        if (nextId === session.currentModeId) return
        setPending(true)
        try {
          await transport.setMode({ sessionId, modeId: nextId })
        } finally {
          setPending(false)
        }
      }}
    />
  )
}

export function ComposerModelPicker({ sessionId }: { sessionId: SessionId }) {
  const session = useAgentSession(sessionId)
  const transport = useAgentTransport()
  const [pending, setPending] = useState(false)

  if (session.modelOptions.length === 0 || !transport.setModel) return null

  const options: SelectOption<string>[] = session.modelOptions.map((m) => ({
    id: m.id as unknown as string,
    label: m.label,
  }))

  const disabled = pending || session.status !== 'ready'
  return (
    <Select
      label="model"
      value={session.modelId as unknown as string | null}
      options={options}
      disabled={disabled}
      onChange={async (next) => {
        if (!transport.setModel || next === null) return
        const nextId = next as unknown as ModelId
        if (nextId === session.modelId) return
        setPending(true)
        try {
          await transport.setModel({ sessionId, modelId: nextId })
        } finally {
          setPending(false)
        }
      }}
    />
  )
}

const REASONING_LABEL: Record<ReasoningEffort, string> = {
  none: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

const REASONING_DESCRIPTION: Record<ReasoningEffort, string> = {
  none: 'No extended thinking',
  minimal: 'Minimal reasoning',
  low: 'Fast, light reasoning',
  medium: 'Balanced reasoning',
  high: 'More thorough reasoning',
  xhigh: 'Extra-high reasoning budget',
  max: 'Maximum reasoning budget',
}

export function ComposerReasoningPicker({ sessionId }: { sessionId: SessionId }) {
  const session = useAgentSession(sessionId)
  const transport = useAgentTransport()
  const [pending, setPending] = useState(false)

  if (!session.capabilities?.supportsReasoning || !transport.setReasoningEffort) return null

  const selectedModel = session.modelOptions.find((m) => m.id === session.modelId)
  const efforts =
    selectedModel?.supportedReasoningEfforts ??
    session.modelOptions.find((m) => m.supportedReasoningEfforts?.length)?.supportedReasoningEfforts ??
    []
  if (efforts.length === 0) return null

  const value = session.reasoningEffort ?? selectedModel?.defaultReasoningEffort ?? efforts[0] ?? null
  const options: SelectOption<string>[] = efforts.map((effort) => ({
    id: effort,
    label: REASONING_LABEL[effort],
    description: REASONING_DESCRIPTION[effort],
  }))

  const disabled = pending || session.status !== 'ready'
  return (
    <Select
      label="thinking"
      value={value}
      options={options}
      disabled={disabled}
      onChange={async (next) => {
        if (!transport.setReasoningEffort || next === null) return
        const effort = next as ReasoningEffort
        if (effort === session.reasoningEffort) return
        setPending(true)
        try {
          await transport.setReasoningEffort({ sessionId, reasoningEffort: effort })
        } finally {
          setPending(false)
        }
      }}
    />
  )
}

/**
 * Kicks off a provider-native code review. Hidden unless the session
 * advertises `capabilities.supportsReview` AND the transport exposes a
 * `startReview` method. For v1 we only offer "review uncommitted
 * changes" — the most common path in the Codex CLI — and defer the
 * base-branch / commit / custom targets to a future menu when there's
 * product demand.
 */
export function ComposerReviewButton({ sessionId }: { sessionId: SessionId }) {
  const session = useAgentSession(sessionId)
  const transport = useAgentTransport()
  const [pending, setPending] = useState(false)

  if (!session.capabilities?.supportsReview) return null
  if (!transport.startReview) return null

  const disabled = pending || session.status !== 'ready'

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={async () => {
        setPending(true)
        try {
          await transport.startReview!({
            sessionId,
            target: { type: 'uncommittedChanges' },
          })
        } finally {
          setPending(false)
        }
      }}
      className={[
        'inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 text-xs',
        'text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
      ].join(' ')}
      title="Have the agent review your uncommitted changes"
    >
      <span aria-hidden className="inline-block size-1.5 rounded-full bg-foreground/50" />
      Review changes
    </button>
  )
}

function AttachmentChip({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
  const pending = attachment.uploaded == null && attachment.error == null
  return (
    <div
      className={cn(
        'group/chip relative flex items-center gap-2 rounded-md border-[0.5px] border-border bg-muted/40 px-1.5 py-1 text-[11px]',
        attachment.error && 'border-destructive/40 bg-destructive/5',
      )}
    >
      {attachment.previewUrl ? (
        <img src={attachment.previewUrl} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
      ) : (
        <span className="h-7 w-7 shrink-0 rounded bg-foreground/10" aria-hidden />
      )}
      <div className="flex max-w-[10rem] flex-col leading-tight">
        <span className="truncate text-foreground" title={attachment.name}>
          {attachment.name}
        </span>
        <span className={cn('font-mono text-[10px]', attachment.error ? 'text-destructive' : 'text-muted-foreground')}>
          {attachment.error
            ? `failed · ${truncate(attachment.error, 24)}`
            : pending
              ? 'uploading…'
              : attachment.mediaType}
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.name}`}
        className="ml-0.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover/chip:opacity-100 focus-visible:opacity-100"
      >
        <IconX />
      </button>
    </div>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}
