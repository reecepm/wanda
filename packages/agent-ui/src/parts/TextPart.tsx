// -----------------------------------------------------------------------------
// TextPart — the headline text of a message. Rendered as markdown for
// assistant messages, plain for user messages (user input is never markdown).
// -----------------------------------------------------------------------------

import type { AttachmentRef, ImageRef, Part, SessionId } from '@wanda/agent-protocol'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '../cn'
import { useAgentTransport } from '../context'
import { IconFile } from '../ui/icons'
import { Markdown } from '../ui/Markdown'

type AttachmentOrImage = AttachmentRef | ImageRef

export function TextPart({
  part,
  sessionId,
  role = 'assistant',
}: {
  part: Extract<Part, { type: 'text' }>
  sessionId?: SessionId
  role?: 'user' | 'assistant' | 'system'
}) {
  const attachments = part.attachments as ReadonlyArray<AttachmentOrImage> | undefined
  const isUser = role === 'user'
  return (
    <div className="flex flex-col gap-2">
      {part.text.length > 0 &&
        (isUser ? (
          <p
            className={cn(
              'whitespace-pre-wrap text-[13px] leading-[1.65] text-foreground',
              part.state === 'streaming' && 'opacity-80',
            )}
          >
            {part.text}
          </p>
        ) : (
          <Markdown text={part.text} className={part.state === 'streaming' ? 'opacity-90' : undefined} />
        ))}
      {attachments && attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((att) => (
            <AttachmentView key={att.id as unknown as string} attachment={att} sessionId={sessionId} />
          ))}
        </div>
      )}
    </div>
  )
}

function AttachmentView({ attachment, sessionId }: { attachment: AttachmentOrImage; sessionId?: SessionId }) {
  const isImage = attachment.kind === 'image' || attachment.mediaType.startsWith('image/')
  if (isImage) {
    return <AttachmentImage attachment={attachment} sessionId={sessionId} />
  }
  return <AttachmentFile attachment={attachment} />
}

function AttachmentImage({ attachment, sessionId }: { attachment: AttachmentOrImage; sessionId?: SessionId }) {
  const transport = useAgentTransport()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = attachment.id as unknown as string
  const sha = attachment.sha256

  useEffect(() => {
    if (!transport.attachmentUrl || !transport.attachmentAuthHeaders) {
      setError('transport has no attachment fetch support')
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    const src = transport.attachmentUrl(attachment.id)
    const headers = transport.attachmentAuthHeaders(sessionId)
    void (async () => {
      try {
        const res = await fetch(src, { headers })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl)
        } catch {
          /* ignore */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sha, sessionId])

  const dimStyle = useMemo(() => {
    if (attachment.kind !== 'image') return undefined
    if (!attachment.width || !attachment.height) return undefined
    return { aspectRatio: `${attachment.width} / ${attachment.height}` } as const
  }, [attachment])

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
        Failed to load image · {error}
      </div>
    )
  }
  return (
    <figure className="max-w-sm overflow-hidden rounded-md border-[0.5px] border-border bg-muted/30" style={dimStyle}>
      {url ? (
        <img src={url} alt={attachment.name ?? ''} className="h-auto w-full" />
      ) : (
        <div className="flex h-24 items-center justify-center text-[11px] text-muted-foreground">Loading…</div>
      )}
      {attachment.name && (
        <figcaption className="border-t-[0.5px] border-border px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {attachment.name}
        </figcaption>
      )}
    </figure>
  )
}

function AttachmentFile({ attachment }: { attachment: AttachmentOrImage }) {
  const size = formatBytes(attachment.size)
  return (
    <div className="flex items-center gap-2 rounded-md border-[0.5px] border-border bg-muted/30 px-2.5 py-1.5 text-[12px]">
      <IconFile className="shrink-0 text-muted-foreground" />
      <div className="flex max-w-[14rem] flex-col leading-tight">
        <span className="truncate text-foreground">{attachment.name ?? attachment.id}</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {attachment.mediaType} · {size}
        </span>
      </div>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
