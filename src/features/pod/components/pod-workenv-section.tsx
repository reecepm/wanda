// PodWorkenvSection — sidebar/dialog row showing the pod's owned VM env.
//
// Pod-owned model: each pod has its own isolated VM. This row shows status
// + an "Edit" button that opens the workenv edit drawer (where the user can
// tweak layers / restart / destroy). For pods without an env, shows nothing
// since envs are bound at pod-create time now.

import { useState } from 'react'
import { useWorkenv, WorkenvEditDialog, WorkenvStateBadge } from '@/features/workenv'
import { RiBox3Line, RiPencilLine } from '@/lib/icons'

export function PodWorkenvSection({ workenvId }: { workenvId: string | null | undefined }) {
  const [editOpen, setEditOpen] = useState(false)
  const { data: workenv } = useWorkenv(workenvId ?? null)

  if (!workenvId) {
    return (
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-xs font-medium text-zinc-300">Environment</div>
          <div className="text-xs text-zinc-500 mt-0.5">No VM attached. Create a new pod with an env to add one.</div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-xs font-medium text-zinc-300">Environment</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            Isolated VM owned by this pod. Edit layers, restart, or destroy from here.
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-800 bg-zinc-900/50 text-[10px] text-zinc-300">
            <RiBox3Line className="size-3 text-zinc-500" />
            <span className="max-w-32 truncate">{workenv?.name ?? workenvId}</span>
            {workenv && <WorkenvStateBadge state={workenv.state} />}
          </span>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
            title="Edit environment"
          >
            <RiPencilLine className="size-3" />
            Edit
          </button>
        </div>
      </div>
      {workenv && (
        <WorkenvEditDialog
          workenvId={workenv.id}
          initialName={workenv.name}
          initialConfig={workenv.config}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
    </>
  )
}
