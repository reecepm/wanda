export function WorkspaceListEmpty({ onCreateWorkspace }: { onCreateWorkspace: () => void }) {
  return (
    <div className="px-3 py-6 text-center">
      <p className="text-xs text-zinc-500 mb-2">No workspaces yet</p>
      <button
        type="button"
        onClick={onCreateWorkspace}
        className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        + Create a workspace
      </button>
    </div>
  )
}
