import { type FormEvent, useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog'
import type { PlanKind } from '../../../../shared/contracts/domain-types'

interface Workspace {
  id: string
  name: string
}

const KIND_OPTIONS: { value: PlanKind; label: string; help: string }[] = [
  { value: 'prd', label: 'PRD', help: 'Long-lived product spec; defaults to active.' },
  { value: 'task-plan', label: 'Task plan', help: 'Implementation plan for a specific piece of work.' },
  { value: 'proposal', label: 'Proposal', help: 'Short-lived; review-loop candidate.' },
]

const TTL_OPTIONS: { value: number | null; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: null, label: 'Never' },
]

export function PlanCreateDialog({
  workspaces,
  defaultWorkspaceId,
  onSubmit,
  onCancel,
}: {
  workspaces: Workspace[]
  defaultWorkspaceId?: string
  onSubmit: (data: { workspaceId: string; title: string; kind: PlanKind; staleAfterDays: number | null }) => void
  onCancel: () => void
}) {
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId ?? workspaces[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<PlanKind>('prd')
  // Default TTL: 30 days for PRDs, none for short-lived flows.
  const [staleAfterDays, setStaleAfterDays] = useState<number | null>(30)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !workspaceId) return
    onSubmit({ workspaceId, title: title.trim(), kind, staleAfterDays })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent className="sm:max-w-[440px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Create plan</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-zinc-500">Workspace</label>
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-zinc-500">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Auth Rework PRD"
              autoFocus
              className="h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-medium text-zinc-500">Kind</label>
            <div className="flex flex-col gap-1.5">
              {KIND_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 hover:border-zinc-700"
                >
                  <input
                    type="radio"
                    name="kind"
                    value={opt.value}
                    checked={kind === opt.value}
                    onChange={() => setKind(opt.value)}
                    className="mt-0.5"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs text-zinc-200">{opt.label}</span>
                    <span className="text-[10px] text-zinc-500">{opt.help}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-zinc-500">Staleness warning after</label>
            <select
              value={staleAfterDays === null ? 'null' : String(staleAfterDays)}
              onChange={(e) => setStaleAfterDays(e.target.value === 'null' ? null : Number(e.target.value))}
              className="h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
            >
              {TTL_OPTIONS.map((o) => (
                <option key={o.label} value={o.value === null ? 'null' : String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-zinc-600">
              Agents reading after this window get a "stale" warning until a human reviews again.
            </p>
          </div>

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!title.trim() || !workspaceId}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
