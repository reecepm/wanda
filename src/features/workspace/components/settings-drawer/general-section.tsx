import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { useSettingsFormContext } from './context'
import { BrowseField, Field, SectionHeading, TextField } from './fields'
import type { SourceMode } from './use-settings-form'
import { WorkspaceIconRow } from './workspace-icon-row'

function SourceModeToggle() {
  const { state, set } = useSettingsFormContext()
  return (
    <Field label="Source">
      <ToggleGroup
        value={[state.sourceMode]}
        onValueChange={(value) => {
          if (value.length) set({ sourceMode: value[0] as SourceMode })
        }}
        variant="outline"
        size="sm"
      >
        <ToggleGroupItem value="directory">Directory</ToggleGroupItem>
        <ToggleGroupItem value="clone">Clone</ToggleGroupItem>
        <ToggleGroupItem value="worktree">Worktree</ToggleGroupItem>
      </ToggleGroup>
    </Field>
  )
}

function DirectorySource() {
  const { state, set, errors, handleBrowseCwd } = useSettingsFormContext()
  return (
    <BrowseField
      label="Working directory"
      value={state.cwd}
      onChange={(cwd) => set({ cwd })}
      onBrowse={handleBrowseCwd}
      placeholder="/path/to/project"
      error={errors.cwd}
    />
  )
}

function CloneSource() {
  const { state, errors, handleCloneUrlChange, handleBrowseCloneDir, cloneTargetPath, set } = useSettingsFormContext()
  return (
    <>
      <TextField
        label="Repository URL"
        value={state.cloneUrl}
        onChange={handleCloneUrlChange}
        placeholder="https://github.com/user/repo.git"
        error={errors.cloneUrl}
        mono
      />
      <BrowseField
        label="Clone to"
        value={state.cloneParentDir}
        onChange={(cloneParentDir) => set({ cloneParentDir })}
        onBrowse={handleBrowseCloneDir}
        placeholder="/path/to/parent/directory"
        error={errors.cloneParentDir}
        target={cloneTargetPath}
      />
    </>
  )
}

function WorktreeSource() {
  const {
    state,
    set,
    errors,
    fetchBranches,
    handleWorktreeBranchChange,
    handleBrowseWorktreeRepo,
    handleBrowseWorktreeDir,
    worktreeTargetPath,
  } = useSettingsFormContext()
  return (
    <>
      <BrowseField
        label="Repository"
        value={state.worktreeRepoPath}
        onChange={(worktreeRepoPath) => set({ worktreeRepoPath })}
        onBrowse={handleBrowseWorktreeRepo}
        onBlur={() => {
          if (state.worktreeRepoPath.trim()) fetchBranches(state.worktreeRepoPath.trim())
        }}
        placeholder="/path/to/existing/repo"
        error={errors.worktreeRepoPath}
      />
      <Field label="Branch" error={errors.worktreeBranch}>
        <select
          value={state.worktreeBranch}
          onChange={(e) => handleWorktreeBranchChange(e.target.value)}
          className="h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
          disabled={state.branches.length === 0}
        >
          <option value="">{state.branches.length === 0 ? 'Select a repository first' : 'Select branch...'}</option>
          {state.branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
              {b.current ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </Field>
      <BrowseField
        label="Worktree location"
        value={state.worktreeParentDir}
        onChange={(worktreeParentDir) => set({ worktreeParentDir })}
        onBrowse={handleBrowseWorktreeDir}
        placeholder="/path/to/worktrees"
        error={errors.worktreeParentDir}
        target={worktreeTargetPath}
      />
    </>
  )
}

export function GeneralSection({ mode, workspaceId }: { mode: 'create' | 'edit'; workspaceId?: string }) {
  const { state, errors, handleNameChange, isEdit, workspace, effectiveSourceMode } = useSettingsFormContext()

  return (
    <section>
      <SectionHeading>General</SectionHeading>
      <div className="flex flex-col gap-3">
        <TextField
          label="Name"
          value={state.name}
          onChange={handleNameChange}
          placeholder="e.g. My App"
          error={errors.name}
        />

        {isEdit && workspaceId && (
          <WorkspaceIconRow workspaceId={workspaceId} workspaceName={state.name || workspace?.name || ''} />
        )}

        {mode === 'create' && <SourceModeToggle />}

        {effectiveSourceMode === 'directory' && <DirectorySource />}
        {effectiveSourceMode === 'clone' && <CloneSource />}
        {effectiveSourceMode === 'worktree' && <WorktreeSource />}
      </div>
    </section>
  )
}
