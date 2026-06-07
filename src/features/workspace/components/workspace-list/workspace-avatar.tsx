import { useState } from 'react'
import type { Workspace } from './types'

export function WorkspaceAvatar({ workspace }: { workspace: Workspace }) {
  const [errored, setErrored] = useState(false)
  const initial = (workspace.name.trim().charAt(0) || '?').toUpperCase()
  const showImage = !!workspace.iconUrl && !errored
  return (
    <div
      className="h-4 w-4 shrink-0 rounded-[3px] overflow-hidden flex items-center justify-center bg-zinc-800 text-zinc-400 text-[9px] font-semibold ring-1 ring-inset ring-white/[0.04]"
      aria-hidden
    >
      {showImage ? (
        <img
          src={workspace.iconUrl!}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setErrored(true)}
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  )
}
