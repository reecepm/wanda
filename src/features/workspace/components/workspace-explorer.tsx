import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNotificationBadges } from '@/features/notifications'
import { PodCreateDialog, PodSettingsDialog as PodSettingsDialogContent, type WorktreeConfig } from '@/features/pod'
import { setNewPodCallback, setPodCycleCallback } from '@/features/shortcuts/use-shortcuts'
import { WorkspaceList } from '@/features/workspace/components/workspace-list'
import { WorkspaceSettingsDrawer } from '@/features/workspace/components/workspace-settings-drawer'
import { resolveBranchPrefix, useWorkspaceExplorer } from '@/features/workspace/hooks/use-workspace-explorer'
import { NavBottomBar, NavTopBar } from '@/layout/app-nav'
import { RiAddLine, RiCloseLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { useUIStore } from '@/stores/ui-store'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from '@/ui/drawer'
import { Input } from '@/ui/input'

type DrawerState = { mode: 'create' } | { mode: 'edit'; workspaceId: string } | null

export function WorkspaceExplorer() {
  const { toggleWorkspaceExpanded } = useUIStore()
  const notificationCounts = useNotificationBadges()

  const [creatingPodForWorkspace, setCreatingPodForWorkspace] = useState<string | null>(null)
  const [isCreatingPod, setIsCreatingPod] = useState(false)
  const [drawerState, setDrawerState] = useState<DrawerState>(null)
  const [templatePodId, setTemplatePodId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [templateScope, setTemplateScope] = useState<string>('global')
  const [branchOffContext, setBranchOffContext] = useState<{
    workspaceId: string
    branchFrom: string
    repoPath: string
  } | null>(null)
  const [settingsPodId, setSettingsPodId] = useState<string | null>(null)

  const {
    workspaces,
    workspacesRaw,
    detectedEditors,
    effectiveExpanded,
    activePodId,
    activeWorkspaceViewId,
    handleSelectPod,
    handleSelectAgent,
    handleSelectChatSession,
    workspaceSettingsMap,
    gitSettings,
    handleCreatePod,
    handleQuickCreatePod,
    handleReorderWorkspaces,
    handleReorderPods,
    handlePodStart,
    handlePodStop,
    handlePodRestart,
    handlePodRename,
    handlePodDuplicate,
    handlePodDelete,
    handlePodOpenInEditor,
    handlePodMoveToWorkspace,
    handlePodSaveAsTemplate,
    handlePodBranchOff,
    handleWorkspaceRename,
    handleWorkspaceDelete,
    pendingWorktreeCleanup,
    confirmWorktreeCleanup,
  } = useWorkspaceExplorer()

  const podWorkspace = creatingPodForWorkspace ? workspacesRaw.find((p) => p.id === creatingPodForWorkspace) : undefined

  const podWorktreeConfig: WorktreeConfig | undefined = (() => {
    if (!creatingPodForWorkspace || !podWorkspace?.cwd) return undefined
    const settings = workspaceSettingsMap.get(creatingPodForWorkspace)
    return {
      enabled: branchOffContext ? true : (settings?.gitWorktreeEnabled ?? false),
      repoPath: branchOffContext?.repoPath ?? podWorkspace.repoPath ?? podWorkspace.cwd,
      workspaceName: podWorkspace.name,
      workspaceCwd: podWorkspace.cwd,
      locationMode: settings?.worktreeLocationMode,
      worktreeBaseDir: settings?.worktreeBaseDir,
      branchFrom: branchOffContext?.branchFrom ?? settings?.branchFrom,
      // Branching off another pod's worktree branch means the base ref is
      // local-only — don't try to resolve it via origin/<branchFrom>.
      baseFromRemote: !branchOffContext,
      copyHiddenFiles: settings?.gitWorktreeCopyHiddenFiles,
      branchPrefix: resolveBranchPrefix(gitSettings ?? {}),
      globalDefaultDir: gitSettings?.['git.defaultWorktreesDir'],
    }
  })()

  async function onCreatePod(data: Parameters<typeof handleCreatePod>[1]) {
    if (!creatingPodForWorkspace) return
    const workspaceId = creatingPodForWorkspace
    setCreatingPodForWorkspace(null)
    setBranchOffContext(null)
    setIsCreatingPod(false)
    void handleCreatePod(workspaceId, data)
  }

  useEffect(() => {
    setPodCycleCallback((direction) => {
      if (!activePodId) return
      const workspace = workspaces.find((w) => w.pods.some((p) => p.id === activePodId))
      if (!workspace || workspace.pods.length < 2) return
      const idx = workspace.pods.findIndex((p) => p.id === activePodId)
      if (idx < 0) return
      const nextIdx =
        direction === 'next'
          ? (idx + 1) % workspace.pods.length
          : (idx - 1 + workspace.pods.length) % workspace.pods.length
      const nextPod = workspace.pods[nextIdx]
      if (nextPod) handleSelectPod(nextPod.id)
    })
    return () => setPodCycleCallback(null)
  }, [workspaces, activePodId, handleSelectPod])

  useEffect(() => {
    setNewPodCallback(() => {
      // Prefer the workspace of the currently active pod; fall back to active workspace view
      let workspaceId: string | null = null
      if (activePodId) {
        const ws = workspaces.find((w) => w.pods.some((p) => p.id === activePodId))
        workspaceId = ws?.id ?? null
      }
      if (!workspaceId && activeWorkspaceViewId) {
        workspaceId = activeWorkspaceViewId
      }
      if (!workspaceId || workspaceId.startsWith('remote:')) return
      const settings = workspaceSettingsMap.get(workspaceId)
      if (settings?.autoGeneratePodName) {
        handleQuickCreatePod(workspaceId)
      } else {
        setCreatingPodForWorkspace(workspaceId)
      }
    })
    return () => setNewPodCallback(null)
  }, [workspaces, activePodId, activeWorkspaceViewId, workspaceSettingsMap, handleQuickCreatePod])

  return (
    <>
      <aside aria-label="Workspace explorer" className="w-60 h-full border-r border-border bg-background flex flex-col">
        <NavTopBar />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-col">
            {/* Workspaces heading — scrolls with list, no separator */}
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <span className="text-[12px] font-medium text-zinc-400">Workspaces</span>
              <button
                type="button"
                onClick={() => setDrawerState({ mode: 'create' })}
                className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition-colors"
                title="New workspace"
              >
                <RiAddLine className="h-3.5 w-3.5" />
              </button>
            </div>
            {notificationCounts && notificationCounts.global.blocking > 0 && (
              <div className="flex items-center gap-2 mx-1.5 px-2 py-1.5 mb-1 rounded-md bg-red-950/40 border border-red-900/50">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                <span className="text-[10px] text-red-300">
                  {notificationCounts.global.blocking} pending approval
                  {notificationCounts.global.blocking !== 1 ? 's' : ''}
                </span>
              </div>
            )}
            <WorkspaceList
              workspaces={workspaces}
              selectedPodId={activePodId ?? undefined}
              selectedWorkspaceViewId={activeWorkspaceViewId ?? undefined}
              expandedWorkspaces={effectiveExpanded}
              onToggleWorkspace={toggleWorkspaceExpanded}
              notificationCounts={notificationCounts}
              onSelectPod={handleSelectPod}
              onCreateWorkspace={() => setDrawerState({ mode: 'create' })}
              onCreatePod={(workspaceId) => {
                const settings = workspaceSettingsMap.get(workspaceId)
                if (settings?.autoGeneratePodName) {
                  handleQuickCreatePod(workspaceId)
                } else {
                  setCreatingPodForWorkspace(workspaceId)
                }
              }}
              onOpenProjectView={(wsId) => {
                useUIStore.getState().setActiveWorkspaceViewId(wsId)
              }}
              onWorkspaceSettings={(workspaceId) => setDrawerState({ mode: 'edit', workspaceId })}
              onWorkspaceRename={handleWorkspaceRename}
              onWorkspaceDelete={handleWorkspaceDelete}
              onReorderWorkspaces={handleReorderWorkspaces}
              onReorderPods={handleReorderPods}
              onPodStart={handlePodStart}
              onPodStop={handlePodStop}
              onPodRestart={handlePodRestart}
              onPodRename={handlePodRename}
              onPodDuplicate={handlePodDuplicate}
              onPodDelete={handlePodDelete}
              onPodOpenInEditor={handlePodOpenInEditor}
              onPodMoveToWorkspace={handlePodMoveToWorkspace}
              onPodSaveAsTemplate={(podId) => {
                setTemplatePodId(podId)
                setTemplateName('')
                setTemplateScope('global')
              }}
              onPodBranchOff={async (podId) => {
                const result = await handlePodBranchOff(podId)
                if (result) {
                  setBranchOffContext(result)
                  setCreatingPodForWorkspace(result.workspaceId)
                }
              }}
              onPodSettings={(podId) => setSettingsPodId(podId)}
              editors={detectedEditors}
              onSelectAgent={handleSelectAgent}
              onSelectChatSession={handleSelectChatSession}
            />
          </div>
        </div>
        <NavBottomBar />
      </aside>

      {/* Workspace create/edit drawer */}
      {drawerState && (
        <WorkspaceSettingsDrawer
          key={drawerState.mode === 'edit' ? drawerState.workspaceId : 'create'}
          mode={drawerState.mode}
          workspaceId={drawerState.mode === 'edit' ? drawerState.workspaceId : undefined}
          open={!!drawerState}
          onOpenChange={(open) => {
            if (!open) setDrawerState(null)
          }}
          onCreated={() => {
            // Invalidation handled inside the drawer
          }}
        />
      )}

      {/* Pod create drawer (right-side slide-in, matches env/template drawers) */}
      <Drawer
        direction="right"
        open={!!creatingPodForWorkspace}
        onOpenChange={(open) => {
          if (!open) {
            setCreatingPodForWorkspace(null)
            setBranchOffContext(null)
          }
        }}
      >
        <DrawerContent className="h-full w-[640px] sm:max-w-[640px]">
          <DrawerHeader className="flex flex-row items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800">
            <div className="min-w-0">
              <DrawerTitle className="text-xs font-medium text-zinc-200 truncate">Create pod</DrawerTitle>
            </div>
            <DrawerClose aria-label="Close" className="p-1 text-zinc-500 hover:text-zinc-300 shrink-0">
              <RiCloseLine className="size-4" />
            </DrawerClose>
          </DrawerHeader>
          <div className="flex flex-col gap-4 p-3 overflow-y-auto flex-1">
            {creatingPodForWorkspace && (
              <PodCreateDialog
                key={creatingPodForWorkspace}
                workspaceId={creatingPodForWorkspace ?? undefined}
                workspaceDefaults={{
                  cwd: podWorkspace?.cwd ?? '',
                  defaultTemplatePodId: workspaceSettingsMap.get(creatingPodForWorkspace)?.defaultTemplatePodId,
                  defaultWorkenvTemplateId: workspaceSettingsMap.get(creatingPodForWorkspace)?.defaultWorkenvTemplateId,
                }}
                worktreeConfig={podWorktreeConfig}
                loading={isCreatingPod}
                onSubmit={onCreatePod}
                onCancel={() => setCreatingPodForWorkspace(null)}
              />
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Save as Template dialog */}
      <Dialog
        open={!!templatePodId}
        onOpenChange={(open) => {
          if (!open) setTemplatePodId(null)
        }}
      >
        <DialogContent className="sm:max-w-80" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              placeholder="Template name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && templateName.trim() && templatePodId) {
                  const wsId = templateScope === 'global' ? null : templateScope
                  handlePodSaveAsTemplate(templatePodId, templateName.trim(), undefined, wsId)
                  setTemplatePodId(null)
                }
              }}
              autoFocus
            />
            <div>
              <label className="text-[11px] font-medium text-zinc-400 mb-1 block">Scope</label>
              <select
                className="w-full h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                value={templateScope}
                onChange={(e) => setTemplateScope(e.target.value)}
              >
                <option value="global">Global (all workspaces)</option>
                {workspacesRaw.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setTemplatePodId(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!templateName.trim()}
              onClick={() => {
                if (templatePodId) {
                  const wsId = templateScope === 'global' ? null : templateScope
                  handlePodSaveAsTemplate(templatePodId, templateName.trim(), undefined, wsId)
                  setTemplatePodId(null)
                }
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pod deletion confirmation dialog (with optional worktree cleanup) */}
      <PodDeleteDialog pending={pendingWorktreeCleanup} onConfirm={confirmWorktreeCleanup} />

      {/* Pod settings dialog (opened from pod context menu) */}
      {settingsPodId && <PodSettingsDialog podId={settingsPodId} onClose={() => setSettingsPodId(null)} />}
    </>
  )
}

function PodSettingsDialog({ podId, onClose }: { podId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: pod } = useQuery(orpcUtils.pod.getById.queryOptions({ input: { id: podId } }))
  if (!pod) return null
  return (
    <PodSettingsDialogContent
      podId={podId}
      runtime={pod.runtime}
      containerLifecycle={pod.containerLifecycle}
      onClose={onClose}
      onSaved={() => {
        queryClient.invalidateQueries({ queryKey: orpcUtils.pod.getById.queryKey({ input: { id: podId } }) })
        onClose()
      }}
    />
  )
}

function PodDeleteDialog({
  pending,
  onConfirm,
}: {
  pending: {
    podId: string
    podName: string
    repoPath?: string
    worktreePath?: string
    defaultDeleteWorktree: boolean
  } | null
  onConfirm: (proceed: boolean, deleteWorktree: boolean) => void
}) {
  return (
    <Dialog
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) onConfirm(false, false)
      }}
    >
      {pending && <PodDeleteDialogContent key={pending.podId} pending={pending} onConfirm={onConfirm} />}
    </Dialog>
  )
}

function PodDeleteDialogContent({
  pending,
  onConfirm,
}: {
  pending: {
    podId: string
    podName: string
    repoPath?: string
    worktreePath?: string
    defaultDeleteWorktree: boolean
  }
  onConfirm: (proceed: boolean, deleteWorktree: boolean) => void
}) {
  const [deleteWorktree, setDeleteWorktree] = useState(pending.defaultDeleteWorktree)

  return (
    <DialogContent className="sm:max-w-96" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Delete Pod?</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-zinc-400">
          Are you sure you want to delete <span className="text-zinc-200 font-medium">{pending.podName}</span>?
        </p>
        {pending.worktreePath && (
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <Checkbox checked={deleteWorktree} onCheckedChange={(v) => setDeleteWorktree(!!v)} />
            Also delete worktree at{' '}
            <code className="text-zinc-300 bg-zinc-800 px-1 py-0.5 rounded text-[10px] break-all">
              {pending.worktreePath}
            </code>
          </label>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onConfirm(false, false)}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onConfirm(true, deleteWorktree)}>
          Delete
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
