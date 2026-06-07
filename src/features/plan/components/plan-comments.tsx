import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useMemo, useState } from 'react'
import { RiAddLine, RiChat3Line, RiCheckboxCircleFill, RiUserLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { cn } from '@/shared/utils'
import { Button } from '@/ui/button'
import type { PlanComment, PlanWithMeta } from '../../../../shared/contracts/domain-types'

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function PlanComments({ plan }: { plan: PlanWithMeta }) {
  const queryClient = useQueryClient()
  const planId = plan.id
  const [composing, setComposing] = useState(false)
  const isReviewLoop = plan.submittedByChatSessionId != null

  const { data: comments = [] } = useQuery(orpcUtils.plan.listComments.queryOptions({ input: { planId } }))

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: orpcUtils.plan.listComments.key({ input: { planId } }) })
  }

  const addMutation = useMutation({
    ...orpcUtils.plan.addComment.mutationOptions(),
    onSuccess: refresh,
  })

  const updateMutation = useMutation({
    ...orpcUtils.plan.updateComment.mutationOptions(),
    onSuccess: refresh,
  })

  const removeMutation = useMutation({
    ...orpcUtils.plan.removeComment.mutationOptions(),
    onSuccess: refresh,
  })

  const headings = useMemo(() => extractHeadings(plan.body), [plan.body])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          {comments.length} comment{comments.length === 1 ? '' : 's'}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setComposing(true)}>
          <RiAddLine className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {composing && (
        <div className="border-b border-zinc-800/60 bg-zinc-900/40 px-3 py-2">
          <CommentComposer
            headings={headings}
            isReviewLoop={isReviewLoop}
            onCancel={() => setComposing(false)}
            onSubmit={async (data) => {
              await addMutation.mutateAsync({ planId, ...data })
              setComposing(false)
            }}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {comments.length === 0 && !composing ? (
          <EmptyState onCompose={() => setComposing(true)} isReviewLoop={isReviewLoop} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {comments.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                isReviewLoop={isReviewLoop}
                onToggleResolved={() => updateMutation.mutate({ commentId: c.id, resolved: c.resolvedAt == null })}
                onToggleInclude={(next) => updateMutation.mutate({ commentId: c.id, includeInFeedback: next })}
                onRemove={() => {
                  if (window.confirm('Delete this comment?')) removeMutation.mutate({ commentId: c.id })
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function CommentRow({
  comment,
  isReviewLoop,
  onToggleResolved,
  onToggleInclude,
  onRemove,
}: {
  comment: PlanComment
  isReviewLoop: boolean
  onToggleResolved: () => void
  onToggleInclude: (next: boolean) => void
  onRemove: () => void
}) {
  const resolved = comment.resolvedAt != null
  return (
    <li
      className={cn(
        'group flex flex-col gap-1.5 rounded-md border px-2 py-2 transition-colors',
        resolved ? 'border-zinc-800/30 bg-zinc-900/20 opacity-70' : 'border-zinc-800/50 bg-zinc-900/40',
      )}
    >
      <div className="flex items-center gap-2">
        <RiUserLine
          className={cn('h-3 w-3 shrink-0', comment.authorKind === 'agent' ? 'text-violet-400' : 'text-zinc-500')}
        />
        <span className="text-[11px] text-zinc-300">
          {comment.authorKind === 'agent' ? 'Agent' : 'User'} · {comment.authorId}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-zinc-600">{formatRelative(comment.createdAt)}</span>
      </div>
      {comment.anchor && (
        <span className="-mt-1 inline-block w-fit rounded bg-zinc-800/60 px-1.5 py-0.5 text-[9px] text-zinc-400">
          @ {comment.anchor}
        </span>
      )}
      <p
        className={cn(
          'text-xs leading-snug text-zinc-200 whitespace-pre-wrap break-words',
          resolved && 'line-through text-zinc-500',
        )}
      >
        {comment.body}
      </p>
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-2">
          {isReviewLoop && (
            <label className="flex cursor-pointer items-center gap-1 text-[10px] text-zinc-400">
              <input
                type="checkbox"
                checked={comment.includeInFeedback}
                onChange={(e) => onToggleInclude(e.target.checked)}
                className="h-3 w-3"
              />
              Send to agent
            </label>
          )}
        </div>
        <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onToggleResolved}
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-200"
          >
            <RiCheckboxCircleFill className={cn('h-3 w-3', resolved ? 'text-emerald-400' : 'text-zinc-700')} />
            {resolved ? 'Reopen' : 'Resolve'}
          </button>
          <button type="button" onClick={onRemove} className="text-[10px] text-zinc-600 hover:text-red-400">
            Delete
          </button>
        </div>
      </div>
    </li>
  )
}

function CommentComposer({
  headings,
  isReviewLoop,
  onSubmit,
  onCancel,
}: {
  headings: string[]
  isReviewLoop: boolean
  onSubmit: (data: { body: string; anchor: string | null }) => Promise<void>
  onCancel: () => void
}) {
  const [body, setBody] = useState('')
  const [anchor, setAnchor] = useState<string>('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    await onSubmit({ body: body.trim(), anchor: anchor || null })
    setBody('')
    setAnchor('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      {headings.length > 0 && (
        <select
          value={anchor}
          onChange={(e) => setAnchor(e.target.value)}
          className="h-6 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-[11px] text-zinc-200 outline-none focus:border-zinc-500"
        >
          <option value="">No anchor (document-level)</option>
          {headings.map((h) => (
            <option key={h} value={h}>
              @ {h}
            </option>
          ))}
        </select>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={isReviewLoop ? 'Feedback for the agent…' : 'Leave a comment…'}
        rows={3}
        autoFocus
        className="resize-none rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
      />
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!body.trim()}>
          {isReviewLoop ? 'Post' : 'Comment'}
        </Button>
      </div>
    </form>
  )
}

function EmptyState({ isReviewLoop, onCompose }: { isReviewLoop: boolean; onCompose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-xs text-zinc-500">
      <RiChat3Line className="h-5 w-5 text-zinc-700" />
      <p>No comments yet.</p>
      <p className="max-w-[200px] text-zinc-600">
        {isReviewLoop
          ? 'Comments here become the feedback bundle returned to the submitting agent on approve / changes.'
          : 'Drop a thought, decision, or open question. Agents see comments alongside the body.'}
      </p>
      <Button variant="outline" size="sm" onClick={onCompose}>
        <RiAddLine className="h-3.5 w-3.5" />
        Add comment
      </Button>
    </div>
  )
}

/**
 * Pull h1 / h2 / h3 lines out of a markdown body and return them as their
 * raw text content, in document order. We anchor comments by the trimmed
 * heading text rather than a slug so display matches what the user wrote.
 */
function extractHeadings(body: string): string[] {
  const out: string[] = []
  for (const raw of body.split('\n')) {
    const m = /^#{1,3}\s+(.+?)\s*$/.exec(raw)
    if (m?.[1]) out.push(m[1])
  }
  return out
}
