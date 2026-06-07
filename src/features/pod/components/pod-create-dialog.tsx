import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LayerEditor, useDefaultLayers, useWorkenvTemplate, useWorkenvTemplates } from '@/features/workenv'
import { resolveBranchName, resolveWorktreeDir } from '@/features/workspace/hooks/use-workspace-explorer'
import { RiBox3Line, RiFolderOpenLine, RiGitBranchLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import type { WorkenvConfig, WorkenvLayer } from '@/types/schema'
import { Button } from '@/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

export interface WorkspaceDefaults {
  cwd: string
  defaultTemplatePodId?: string | null
  defaultWorkenvTemplateId?: string | null
}

export interface PodCreateData {
  name: string
  cwd: string
  templatePodId?: string
  worktree?: {
    repoPath: string
    branchName: string
    directory: string
    branchFrom?: string
    baseFromRemote?: boolean
    copyHiddenFiles?: boolean
    sourceDir?: string
  }
  importedWorktree?: {
    repoPath: string
    worktreePath: string
    worktreeBranch: string
  }
  /**
   * Optional VM definition. When set, creates a fresh workenv post-pod-create
   * and attaches it. Each pod gets its own isolated VM — sharing isn't a
   * thing. Skip the env entirely (envMode='none') for plain local-pty pods.
   */
  env?: {
    templateId: string | null
    config?: Partial<WorkenvConfig>
    layers?: WorkenvLayer[]
  }
  initialTerminal?: {
    name: string
    command?: string
  }
}

export interface WorktreeConfig {
  enabled: boolean
  repoPath: string
  workspaceName: string
  workspaceCwd: string
  locationMode?: string | null
  worktreeBaseDir?: string | null
  branchFrom?: string | null
  // true when branchFrom is a base branch tracked on origin (fork off
  // origin/<branchFrom>); false when branching off a local-only ref
  // such as another pod's worktree branch.
  baseFromRemote?: boolean
  copyHiddenFiles?: boolean
  branchPrefix: string
  globalDefaultDir?: string | null
}

interface PodCreateDialogProps {
  workspaceId?: string
  workspaceDefaults: WorkspaceDefaults
  worktreeConfig?: WorktreeConfig
  loading?: boolean
  onSubmit: (data: PodCreateData) => void
  onCancel: () => void
}

type ViewMode = 'simple' | 'advanced'
type WorktreeMode = 'none' | 'create' | 'import'

export function PodCreateDialog({
  workspaceId,
  workspaceDefaults,
  worktreeConfig,
  loading,
  onSubmit,
  onCancel,
}: PodCreateDialogProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('simple')
  const [name, setName] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [errors, setErrors] = useState<{ name?: string; cwd?: string; baseBranch?: string }>({})

  useEffect(() => {
    const frame = requestAnimationFrame(() => nameInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  // Worktree state
  const [worktreeMode, setWorktreeMode] = useState<WorktreeMode>(worktreeConfig?.enabled ? 'create' : 'none')
  const worktreeEnabled = worktreeMode === 'create'
  // Per-pod override for the base branch. Initialized from the workspace
  // default so the user only has to fill it in when no default is configured.
  const [baseBranchInput, setBaseBranchInput] = useState<string>(worktreeConfig?.branchFrom ?? '')
  const effectiveBranchFrom = baseBranchInput.trim() || (worktreeConfig?.branchFrom ?? '')
  useEffect(() => {
    if (!baseBranchInput && worktreeConfig?.branchFrom) setBaseBranchInput(worktreeConfig.branchFrom)
  }, [baseBranchInput, worktreeConfig?.branchFrom])

  // Import worktree state
  const [importPath, setImportPath] = useState('')
  const [importDetected, setImportDetected] = useState<{
    repoPath: string
    worktreePath: string
    worktreeBranch: string
  } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importLoading, setImportLoading] = useState(false)

  const resolvedWorktree = useMemo(() => {
    if (!worktreeConfig || !worktreeEnabled || !name.trim()) return null
    const branchName = resolveBranchName(worktreeConfig.branchPrefix, name.trim())
    const directory = resolveWorktreeDir(
      worktreeConfig.locationMode,
      worktreeConfig.workspaceCwd,
      worktreeConfig.workspaceName,
      branchName,
      worktreeConfig.worktreeBaseDir,
      worktreeConfig.globalDefaultDir,
    )
    return { branchName, directory }
  }, [worktreeConfig, worktreeEnabled, name])

  // Advanced overrides — initialized from workspace defaults
  const [cwd, setCwd] = useState('')
  const [templatePodId, setTemplatePodId] = useState(workspaceDefaults.defaultTemplatePodId ?? '')
  const [templatePodTouched, setTemplatePodTouched] = useState(false)
  useEffect(() => {
    if (!templatePodTouched) setTemplatePodId(workspaceDefaults.defaultTemplatePodId ?? '')
  }, [templatePodTouched, workspaceDefaults.defaultTemplatePodId])

  const { data: templates = [] } = useQuery(
    orpcUtils.template.list.queryOptions(workspaceId ? { input: { workspaceId } } : {}),
  )

  // Each pod gets its own VM, optionally seeded from a saved env (workenv
  // template). VM mode is opt-in (default disabled).
  const defaultLayers = useDefaultLayers()
  const { data: envTemplates = [] } = useWorkenvTemplates()
  const [envMode, setEnvMode] = useState<'on' | 'off'>(workspaceDefaults.defaultWorkenvTemplateId ? 'on' : 'off')
  const [envTemplateId, setEnvTemplateId] = useState<string | null>(workspaceDefaults.defaultWorkenvTemplateId ?? null)
  const [envTemplateTouched, setEnvTemplateTouched] = useState(false)
  // Fetch the selected env directly so we never read stale layers from the
  // list cache after the user edited the env in another drawer.
  const { data: selectedEnv } = useWorkenvTemplate(envTemplateId)
  const [envLayers, setEnvLayers] = useState<WorkenvLayer[]>([])
  const [envLayersTouched, setEnvLayersTouched] = useState(false)
  const [envLayersExpanded, setEnvLayersExpanded] = useState(false)
  const envPortalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (envTemplateTouched) return
    const defaultId = workspaceDefaults.defaultWorkenvTemplateId ?? null
    setEnvTemplateId(defaultId)
    setEnvMode(defaultId ? 'on' : 'off')
  }, [envTemplateTouched, workspaceDefaults.defaultWorkenvTemplateId])

  // Seed defaults the moment the catalog loads. Stops once the user picks
  // a saved env or edits the layer list manually.
  useEffect(() => {
    if (envLayersTouched || envTemplateId) return
    if (defaultLayers.length === 0) return
    setEnvLayers(defaultLayers)
  }, [defaultLayers, envLayersTouched, envTemplateId])

  // Picking a saved env replaces the layer list with that env's layers.
  // Reads from the per-id query so we always see freshly-saved edits.
  useEffect(() => {
    if (!envTemplateId || !selectedEnv) return
    const tplLayers = (selectedEnv.config as { layers?: WorkenvLayer[] }).layers ?? []
    setEnvLayers(tplLayers)
    setEnvLayersTouched(false)
  }, [envTemplateId, selectedEnv])

  function handleEnvLayersChange(next: WorkenvLayer[]) {
    setEnvLayers(next)
    setEnvLayersTouched(true)
  }

  // Resolve effective values: override if set, otherwise workspace default
  const effectiveCwd = cwd.trim() || workspaceDefaults.cwd

  function validate() {
    const next: typeof errors = {}
    if (!name.trim()) next.name = 'Name is required'
    if (viewMode === 'advanced' && !effectiveCwd) next.cwd = 'Working directory is required'
    if (worktreeMode === 'create' && !effectiveBranchFrom) {
      next.baseBranch = 'Base branch is required'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    const data: PodCreateData = {
      name: name.trim(),
      cwd: effectiveCwd,
    }

    if (templatePodId) {
      data.templatePodId = templatePodId
    }

    if (worktreeMode === 'create' && worktreeConfig && resolvedWorktree) {
      data.worktree = {
        repoPath: worktreeConfig.repoPath,
        branchName: resolvedWorktree.branchName,
        directory: resolvedWorktree.directory,
        branchFrom: effectiveBranchFrom || undefined,
        baseFromRemote: worktreeConfig.baseFromRemote,
        copyHiddenFiles: worktreeConfig.copyHiddenFiles || undefined,
        sourceDir: worktreeConfig.copyHiddenFiles ? worktreeConfig.workspaceCwd : undefined,
      }
    }

    if (worktreeMode === 'import' && importDetected) {
      data.importedWorktree = importDetected
    }

    if (envMode === 'on' && (envTemplateId || envLayers.length > 0)) {
      const templateConfig =
        envTemplateId && envLayersTouched && selectedEnv
          ? {
              ...selectedEnv.config,
              ...(envLayers.length > 0 ? { layers: envLayers } : { layers: undefined }),
            }
          : undefined
      data.env = {
        templateId: envTemplateId,
        config: templateConfig,
        layers: !envTemplateId && envLayers.length > 0 ? envLayers : undefined,
      }
    }

    onSubmit(data)
  }

  async function handleBrowse() {
    const dir = await orpcUtils.app.selectDirectory.call({})
    if (dir) setCwd(dir)
  }

  // Summary of what will be inherited
  const inheritSummary = [workspaceDefaults.cwd && `dir: ${workspaceDefaults.cwd}`].filter(Boolean)

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 relative">
      <div ref={envPortalRef} className="absolute" />

      <div className="flex flex-col gap-1">
        <label htmlFor="pod-name" className="text-xs text-zinc-400">
          Name
        </label>
        <input
          id="pod-name"
          ref={nameInputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Dev Server"
          className="h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
        />
        {errors.name && <p className="text-[10px] text-red-400">{errors.name}</p>}
      </div>

      {worktreeConfig && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <RiGitBranchLine className="size-3.5 text-blue-400" />
            <span>Git worktree</span>
          </div>
          <ToggleGroup
            value={[worktreeMode]}
            onValueChange={(value) => {
              if (value.length) setWorktreeMode(value[0] as WorktreeMode)
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="none">None</ToggleGroupItem>
            <ToggleGroupItem value="create">Create new</ToggleGroupItem>
            <ToggleGroupItem value="import">Import existing</ToggleGroupItem>
          </ToggleGroup>

          {worktreeMode === 'create' && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col gap-1">
                <label htmlFor="pod-base-branch" className="text-[10px] text-zinc-500">
                  Base branch
                </label>
                <input
                  id="pod-base-branch"
                  type="text"
                  value={baseBranchInput}
                  onChange={(e) => setBaseBranchInput(e.target.value)}
                  placeholder={worktreeConfig.branchFrom ?? 'e.g. main'}
                  className="h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500 font-mono"
                />
                {errors.baseBranch && <p className="text-[10px] text-red-400">{errors.baseBranch}</p>}
              </div>
              {resolvedWorktree && (
                <div className="flex flex-col gap-1 text-[10px] text-zinc-500">
                  <p>
                    Branch: <span className="text-zinc-300 font-mono break-all">{resolvedWorktree.branchName}</span>
                  </p>
                  <p>
                    Dir: <span className="text-zinc-300 font-mono break-all">{resolvedWorktree.directory}</span>
                  </p>
                </div>
              )}
              {!name.trim() && <p className="text-[10px] text-zinc-600">Enter a name to see worktree details</p>}
            </div>
          )}

          {worktreeMode === 'import' && (
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-1">
                <input
                  type="text"
                  value={importPath}
                  onChange={(e) => setImportPath(e.target.value)}
                  placeholder="Path to existing worktree"
                  className="flex-1 h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500 font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={async () => {
                    const dir = await orpcUtils.app.selectDirectory.call({})
                    if (!dir) return
                    setImportPath(dir)
                    setImportError(null)
                    setImportLoading(true)
                    try {
                      const result = await orpcUtils.app.detectWorktree.call({ directory: dir })
                      if (!result.isWorktree) {
                        setImportError('This directory is not a git worktree')
                        setImportDetected(null)
                      } else {
                        setImportDetected({
                          repoPath: result.repoPath,
                          worktreePath: result.worktreePath,
                          worktreeBranch: result.worktreeBranch,
                        })
                        setImportError(null)
                      }
                    } catch (err) {
                      setImportError(err instanceof Error ? err.message : 'Detection failed')
                      setImportDetected(null)
                    } finally {
                      setImportLoading(false)
                    }
                  }}
                >
                  <RiFolderOpenLine className="h-3.5 w-3.5" />
                </Button>
              </div>
              {importLoading && <p className="text-[10px] text-zinc-500">Detecting worktree...</p>}
              {importError && <p className="text-[10px] text-red-400">{importError}</p>}
              {importDetected && (
                <div className="flex flex-col gap-1 text-[10px] text-zinc-500">
                  <p>
                    Repo: <span className="text-zinc-300 font-mono break-all">{importDetected.repoPath}</span>
                  </p>
                  <p>
                    Branch: <span className="text-zinc-300 font-mono break-all">{importDetected.worktreeBranch}</span>
                  </p>
                  <p>
                    Path: <span className="text-zinc-300 font-mono break-all">{importDetected.worktreePath}</span>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {templates.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor="pod-template" className="text-xs text-zinc-400">
            Template
          </label>
          <select
            id="pod-template"
            value={templatePodId}
            onChange={(e) => {
              setTemplatePodTouched(true)
              setTemplatePodId(e.target.value)
            }}
            className="h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
          >
            <option value="">None</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {!t.workspaceId ? ' (global)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-zinc-800 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <RiBox3Line className="size-3.5 text-emerald-400" />
            <span>Environment</span>
            <span className="text-[10px] text-zinc-600">isolated VM per pod</span>
          </div>
          <ToggleGroup
            value={[envMode]}
            onValueChange={(value) => {
              if (value.length) setEnvMode(value[0] as 'on' | 'off')
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="on">VM</ToggleGroupItem>
            <ToggleGroupItem value="off">Local</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {envMode === 'on' && (
          <div className="flex flex-col gap-2">
            {envTemplates.length > 0 && (
              <div className="flex flex-col gap-1">
                <label htmlFor="pod-env-template" className="text-[10px] text-zinc-500">
                  Start from saved env (optional)
                </label>
                <select
                  id="pod-env-template"
                  value={envTemplateId ?? ''}
                  onChange={(e) => {
                    setEnvTemplateTouched(true)
                    const v = e.target.value || null
                    setEnvTemplateId(v)
                    if (v === null) setEnvLayersTouched(false)
                  }}
                  className="h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                >
                  <option value="">Defaults (base + auth)</option>
                  {envTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.builtIn ? ' (built-in)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => setEnvLayersExpanded(!envLayersExpanded)}
              className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 text-left transition-colors"
            >
              <span className="text-[11px] text-zinc-400">
                {envLayers.length} layer{envLayers.length === 1 ? '' : 's'}
                {!envLayersTouched && ' (defaults)'}
              </span>
              <span className="text-[10px] text-zinc-500">{envLayersExpanded ? '▾ Customize' : '▸ Customize'}</span>
            </button>

            {envLayersExpanded && (
              <LayerEditor value={envLayers} onChange={handleEnvLayersChange} portalContainer={envPortalRef} />
            )}
          </div>
        )}
      </div>

      {viewMode === 'simple' && inheritSummary.length > 0 && (
        <p className="text-[10px] text-zinc-600">Inherits from workspace: {inheritSummary.join(', ')}</p>
      )}

      <ToggleGroup
        value={[viewMode]}
        onValueChange={(value) => {
          if (value.length) setViewMode(value[0] as ViewMode)
        }}
        variant="outline"
        size="sm"
      >
        <ToggleGroupItem value="simple">Simple</ToggleGroupItem>
        <ToggleGroupItem value="advanced">Advanced</ToggleGroupItem>
      </ToggleGroup>

      {viewMode === 'advanced' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="pod-cwd" className="text-xs text-zinc-400">
              Working directory
            </label>
            <div className="flex gap-1">
              <input
                id="pod-cwd"
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder={workspaceDefaults.cwd || '/path/to/project'}
                className="flex-1 h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500 font-mono"
              />
              <Button type="button" variant="outline" size="icon-sm" onClick={handleBrowse}>
                <RiFolderOpenLine className="h-3.5 w-3.5" />
              </Button>
            </div>
            {!cwd && workspaceDefaults.cwd && (
              <p className="text-[10px] text-zinc-600">Leave empty to use workspace default</p>
            )}
            {errors.cwd && <p className="text-[10px] text-red-400">{errors.cwd}</p>}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? 'Creating...' : 'Create'}
        </Button>
      </div>
    </form>
  )
}
