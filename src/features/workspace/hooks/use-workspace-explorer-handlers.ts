import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { generateUniquePodName, type PodCreateData } from '@/features/pod'
import { orpcUtils, parseNamespacedId } from '@/shared/orpc'
import { useUIStore } from '@/stores/ui-store'
import { focusPodAgent } from '../utils/focus-pod-agent'
import { focusPodChatSession } from '../utils/focus-pod-chat-session'
import type { PendingPodsApi } from './use-pending-pods'
import type { ResolveClient } from './use-resolve-client'
import type { WorkspaceExplorerData } from './use-workspace-explorer-data'
import { resolveBranchName, resolveBranchPrefix, resolveWorktreeDir } from './worktree'

type ExplorerHandlerDeps = Pick<
  PendingPodsApi,
  | 'beginPendingPod'
  | 'beginExistingPodProgress'
  | 'updatePendingPod'
  | 'clearPendingPod'
  | 'finishPendingPod'
  | 'failPendingPod'
  | 'pendingByWorkenvIdRef'
> &
  Pick<WorkspaceExplorerData, 'workspacesRaw' | 'podQueries' | 'gitSettings' | 'workspaceSettingsMap'> & {
    resolveClient: ResolveClient
  }

/**
 * Every mutation handler the sidebar context menus invoke. Each one routes
 * through `resolveClient(id)` so an action on a remote workspace / pod talks
 * to the authoritative backend, then drives the pending-pod progress UI and
 * the relevant cache invalidations.
 */
export function useWorkspaceExplorerHandlers(deps: ExplorerHandlerDeps) {
  const {
    resolveClient,
    beginPendingPod,
    beginExistingPodProgress,
    updatePendingPod,
    clearPendingPod,
    finishPendingPod,
    failPendingPod,
    pendingByWorkenvIdRef,
    workspacesRaw,
    podQueries,
    gitSettings,
    workspaceSettingsMap,
  } = deps

  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { activePodId, setActivePodId } = useUIStore()

  const invalidateWorkspaceList = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: orpcUtils.workspace.list.key(),
    })
  }, [queryClient])

  const invalidateAllPodLists = useCallback(() => {
    for (const workspace of workspacesRaw) {
      queryClient.invalidateQueries({ queryKey: orpcUtils.pod.list.key({ input: { workspaceId: workspace.id } }) })
    }
  }, [queryClient, workspacesRaw])

  const handleSelectPod = useCallback(
    (podId: string) => {
      setActivePodId(podId)
      navigate({ to: '/pods/$podId', params: { podId } })
    },
    [setActivePodId, navigate],
  )

  const handleSelectAgent = useCallback(
    (podId: string, agentId: string) => {
      setActivePodId(podId)
      navigate({ to: '/pods/$podId', params: { podId } })
      focusPodAgent(queryClient, podId, { by: 'agentId', agentId })
    },
    [setActivePodId, navigate, queryClient],
  )

  const handleSelectChatSession = useCallback(
    (podId: string, sessionItemId: string) => {
      setActivePodId(podId)
      navigate({ to: '/pods/$podId', params: { podId } })
      focusPodChatSession(podId, sessionItemId)
    },
    [setActivePodId, navigate],
  )

  const handleCreatePod = useCallback(
    async (workspaceId: string, data: PodCreateData) => {
      let pendingId = beginPendingPod(
        workspaceId,
        data.name,
        data.worktree ? 'Creating worktree' : data.importedWorktree ? 'Importing worktree' : 'Creating pod',
        !!data.worktree || !!data.importedWorktree,
      )
      let cwd = data.cwd
      let gitContext:
        | { repoPath: string; baseRef?: string; source: 'auto'; worktreePath?: string; worktreeBranch?: string }
        | undefined

      if (data.worktree) {
        try {
          updatePendingPod(pendingId, { label: `Creating worktree ${data.worktree.branchName}` })
          await orpcUtils.app.createWorktree.call({
            repoPath: data.worktree.repoPath,
            branchName: data.worktree.branchName,
            directory: data.worktree.directory,
            branchFrom: data.worktree.branchFrom,
            baseFromRemote: data.worktree.baseFromRemote,
            copyHiddenFiles: data.worktree.copyHiddenFiles,
            sourceDir: data.worktree.sourceDir,
          })
          cwd = data.worktree.directory
          gitContext = {
            repoPath: data.worktree.repoPath,
            baseRef: data.worktree.branchFrom,
            source: 'auto',
            worktreePath: data.worktree.directory,
            worktreeBranch: data.worktree.branchName,
          }
        } catch (err) {
          failPendingPod(pendingId, `Worktree failed: ${err instanceof Error ? err.message : 'unknown error'}`)
          toast.error(`Worktree creation failed: ${err instanceof Error ? err.message : 'unknown error'}`)
          return
        }
      } else if (data.importedWorktree) {
        updatePendingPod(pendingId, { label: 'Importing worktree' })
        cwd = data.importedWorktree.worktreePath
        gitContext = {
          repoPath: data.importedWorktree.repoPath,
          source: 'auto',
          worktreePath: data.importedWorktree.worktreePath,
          worktreeBranch: data.importedWorktree.worktreeBranch,
        }
      }

      try {
        // Resolve the backend that owns this workspace. If the workspace
        // is on a paired server, every child call (create pod, attach
        // terminal, apply template, hooks) MUST hit the same backend.
        updatePendingPod(pendingId, { label: 'Preparing workspace' })
        const { client, realId: realWorkspaceId } = await resolveClient(workspaceId)
        const isRemote = realWorkspaceId !== workspaceId

        const createInput: Parameters<typeof client.pod.create>[0] = {
          workspaceId: realWorkspaceId,
          name: data.name,
          cwd,
        }
        if (gitContext) {
          createInput.gitContext = gitContext
        }

        updatePendingPod(pendingId, { label: 'Creating pod' })
        const pod = await client.pod.create(createInput)

        // Navigate using the namespaced id so the pod page knows it's remote.
        const navPodId = isRemote ? `remote:${parseNamespacedId(workspaceId)!.registryId}:${pod.id}` : pod.id
        updatePendingPod(pendingId, { id: navPodId, label: 'Pod created' })
        pendingId = navPodId

        if (isRemote) {
          const parsed = parseNamespacedId(workspaceId)
          if (parsed) {
            queryClient.invalidateQueries({
              queryKey: ['remote-pod-list', parsed.registryId, realWorkspaceId] as const,
            })
          }
        } else {
          queryClient.invalidateQueries({
            queryKey: orpcUtils.pod.list.key({ input: { workspaceId: realWorkspaceId } }),
          })
        }

        let workenvId: string | null = null
        // Pod-owned VM: create a fresh workenv per pod and attach. Each pod
        // gets its own isolated VM — no sharing across pods.
        if (data.env) {
          const slug = `${pod.id.slice(0, 8)}`
          updatePendingPod(pendingId, { label: 'Creating environment VM' })
          const envConfig = data.env.config ?? {}
          const w = await client.workenv.create({
            name: data.name,
            slug,
            templateId: data.env.templateId ?? undefined,
            config: {
              ...envConfig,
              runtime: 'orbstack',
              worktreePath: cwd,
              ...(data.env.layers && data.env.layers.length > 0
                ? { layers: data.env.layers }
                : !data.env.config && data.env.templateId
                  ? { extends: [data.env.templateId] }
                  : {}),
            },
          })
          if (w.state === 'error') {
            throw new Error(w.lastError ?? 'environment creation failed')
          }
          workenvId = w.id
          pendingByWorkenvIdRef.current.set(w.id, pendingId)
          updatePendingPod(pendingId, { label: 'Attaching environment' })
          await client.pod.setWorkenv({ id: pod.id, workenvId: w.id })
        }

        updatePendingPod(pendingId, { label: data.templatePodId ? 'Applying pod template' : 'Creating terminal' })
        if (data.templatePodId) {
          await client.pod.applyTemplate({ podId: pod.id, templatePodId: data.templatePodId })
        } else if (data.initialTerminal) {
          await client.pod.addTerminal({
            podId: pod.id,
            name: data.initialTerminal.name,
            command: data.initialTerminal.command,
          })
        } else {
          await client.pod.addTerminal({ podId: pod.id, name: 'shell' })
        }

        updatePendingPod(pendingId, { label: 'Installing agent hooks' })
        await client.pod.injectHooks({ podId: pod.id }).catch((err) => {
          // Agent hook injection is best-effort — the pod still runs without them,
          // so we log and continue rather than aborting the create flow.
          console.warn('[workspace] pod.injectHooks failed (pod still created):', { podId: pod.id, err })
        })

        if (workenvId) {
          updatePendingPod(pendingId, { label: 'Starting environment' })
          await client.workenv.start({ id: workenvId })
          pendingByWorkenvIdRef.current.delete(workenvId)
        }

        finishPendingPod(pendingId)
        setActivePodId(navPodId)
        navigate({ to: '/pods/$podId', params: { podId: navPodId } })
      } catch (err) {
        failPendingPod(pendingId, err instanceof Error ? err.message : 'Pod creation failed')
        toast.error(err instanceof Error ? err.message : 'Pod creation failed')
      }
    },
    [
      beginPendingPod,
      failPendingPod,
      finishPendingPod,
      queryClient,
      setActivePodId,
      navigate,
      resolveClient,
      updatePendingPod,
      pendingByWorkenvIdRef,
    ],
  )

  // Auto-create pod using workspace defaults (no dialog)
  const handleQuickCreatePod = useCallback(
    async (workspaceId: string) => {
      const ws = workspacesRaw.find((w) => w.id === workspaceId)
      if (!ws) return
      const settings = workspaceSettingsMap.get(workspaceId)

      const existingPods = podQueries[workspacesRaw.indexOf(ws)]?.data ?? []
      const name = settings?.autoGeneratePodName ? generateUniquePodName(existingPods.map((p) => p.name)) : 'New Pod'

      const data: PodCreateData = {
        name,
        cwd: ws.cwd,
      }

      if (settings?.gitWorktreeEnabled) {
        const repoPath = ws.repoPath ?? ws.cwd
        const prefix = resolveBranchPrefix(gitSettings ?? {})
        const branchName = resolveBranchName(prefix, name)
        const worktreeDir = resolveWorktreeDir(
          settings.worktreeLocationMode,
          ws.cwd,
          ws.name,
          branchName,
          settings.worktreeBaseDir,
          gitSettings?.['git.defaultWorktreesDir'],
        )

        data.worktree = {
          repoPath,
          branchName,
          directory: worktreeDir,
          branchFrom: settings.branchFrom || undefined,
          baseFromRemote: true,
          copyHiddenFiles: settings.gitWorktreeCopyHiddenFiles || undefined,
          sourceDir: settings.gitWorktreeCopyHiddenFiles ? ws.cwd : undefined,
        }
      }

      if (settings?.defaultWorkenvTemplateId) {
        data.env = { templateId: settings.defaultWorkenvTemplateId }
      }
      if (settings?.defaultTemplatePodId) {
        data.templatePodId = settings.defaultTemplatePodId
      } else if (settings?.scriptSetup) {
        data.initialTerminal = { name: 'Setup', command: settings.scriptSetup }
      }

      await handleCreatePod(workspaceId, data)
    },
    [workspacesRaw, workspaceSettingsMap, podQueries, gitSettings, handleCreatePod],
  )

  const handleReorderWorkspaces = useCallback(
    async (workspaceIds: string[]) => {
      // Workspace reordering is only meaningful within a single backend
      // (local or one paired server). Group by backend, reorder within
      // each group. Local and remote workspaces are interleaved in the
      // flat sidebar list but each backend owns its own sort index.
      const byBackend = new Map<string | null, string[]>()
      for (const id of workspaceIds) {
        const parsed = parseNamespacedId(id)
        const key = parsed?.registryId ?? null
        const list = byBackend.get(key) ?? []
        list.push(id)
        byBackend.set(key, list)
      }
      await Promise.all(
        Array.from(byBackend.values()).flatMap((ids) =>
          ids.map(async (id, index) => {
            const { client, realId } = await resolveClient(id)
            await client.workspace.update({ id: realId, sortOrder: index })
          }),
        ),
      )
      invalidateWorkspaceList()
    },
    [invalidateWorkspaceList, resolveClient],
  )

  const handleReorderPods = useCallback(
    async (workspaceId: string, podIds: string[]) => {
      await Promise.all(
        podIds.map(async (id, index) => {
          const { client, realId } = await resolveClient(id)
          await client.pod.update({ id: realId, sortOrder: index })
        }),
      )
      const parsed = parseNamespacedId(workspaceId)
      if (parsed) {
        queryClient.invalidateQueries({
          queryKey: ['remote-pod-list', parsed.registryId, parsed.rawId] as const,
        })
      } else {
        queryClient.invalidateQueries({ queryKey: orpcUtils.pod.list.key({ input: { workspaceId } }) })
      }
    },
    [queryClient, resolveClient],
  )

  const handlePodStart = useCallback(
    async (podId: string) => {
      const { client, realId } = await resolveClient(podId)
      await client.pod.start({ id: realId })

      // If workspace has a run script, add a terminal for it. Settings
      // only exist for LOCAL workspaces in our settings map; remote pods
      // skip this enhancement (workspace settings aren't fanned out).
      if (podId === realId) {
        const pod = await client.pod.getById({ id: realId })
        if (pod?.workspaceId) {
          const wsSettings = workspaceSettingsMap.get(pod.workspaceId)
          if (wsSettings?.scriptRun) {
            const terminals = await client.pod.listTerminals({ podId: realId })
            const hasRun = terminals.some((t) => t.name === 'Run' && t.command === wsSettings.scriptRun)
            if (!hasRun) {
              await client.pod.addTerminal({ podId: realId, name: 'Run', command: wsSettings.scriptRun })
            }
          }
        }
      }
    },
    [workspaceSettingsMap, resolveClient],
  )

  const handlePodStop = useCallback(
    async (podId: string) => {
      const { client, realId } = await resolveClient(podId)
      await client.pod.stop({ id: realId })
    },
    [resolveClient],
  )

  const handlePodRestart = useCallback(
    async (podId: string) => {
      const { client, realId } = await resolveClient(podId)
      await client.pod.restart({ id: realId })
    },
    [resolveClient],
  )

  const handlePodRename = useCallback(
    async (podId: string, name: string) => {
      const { client, realId } = await resolveClient(podId)
      await client.pod.update({ id: realId, name })
      invalidateAllPodLists()
      // The detail-level getById key for local pods uses the unwrapped
      // id; for remote we just rely on the push-invalidation path.
      if (podId === realId) {
        queryClient.invalidateQueries({ queryKey: orpcUtils.pod.getById.key({ input: { id: realId } }) })
      }
    },
    [invalidateAllPodLists, queryClient, resolveClient],
  )

  const handlePodDuplicate = useCallback(
    async (podId: string) => {
      const { client, realId } = await resolveClient(podId)
      const newPod = await client.pod.duplicate({ id: realId })
      invalidateAllPodLists()
      if (newPod) {
        // Re-namespace for navigation if the source was remote.
        const parsed = parseNamespacedId(podId)
        const navId = parsed ? `remote:${parsed.registryId}:${newPod.id}` : newPod.id
        setActivePodId(navId)
        navigate({ to: '/pods/$podId', params: { podId: navId } })
      }
    },
    [invalidateAllPodLists, setActivePodId, navigate, resolveClient],
  )

  const [pendingWorktreeCleanup, setPendingWorktreeCleanup] = useState<{
    podId: string
    podName: string
    workspaceId: string
    repoPath?: string
    worktreePath?: string
    defaultDeleteWorktree: boolean
  } | null>(null)

  const removePodFromListCache = useCallback(
    (workspaceId: string, podId: string) => {
      const podParsed = parseNamespacedId(podId)
      const wsParsed = parseNamespacedId(workspaceId)
      if (wsParsed) {
        queryClient.setQueryData<Array<{ id: string }>>(
          ['remote-pod-list', wsParsed.registryId, wsParsed.rawId] as const,
          (old) => old?.filter((p) => p.id !== (podParsed?.rawId ?? podId)),
        )
        return
      }
      queryClient.setQueryData<Array<{ id: string }>>(orpcUtils.pod.list.key({ input: { workspaceId } }), (old) =>
        old?.filter((p) => p.id !== podId),
      )
    },
    [queryClient],
  )

  const confirmWorktreeCleanup = useCallback(
    async (proceed: boolean, deleteWorktree: boolean) => {
      if (!pendingWorktreeCleanup) return
      const { podId, podName, workspaceId, repoPath, worktreePath } = pendingWorktreeCleanup
      setPendingWorktreeCleanup(null)

      if (!proceed) return

      const parsed = parseNamespacedId(podId)
      const { client, realId } = await resolveClient(podId)

      beginExistingPodProgress(podId, workspaceId, podName, 'Deleting pod', 'stopping', !!worktreePath)
      if (activePodId === podId) {
        setActivePodId(null)
        navigate({ to: '/' })
      }

      if (!parsed && worktreePath) {
        // Run archive script if configured. Best-effort: a failing archive
        // script shouldn't strand the pod row in the DB.
        updatePendingPod(podId, { label: 'Running archive script' })
        const pod = await orpcUtils.pod.getById.call({ id: podId })
        const ws = workspacesRaw.find((w) => w.id === pod?.workspaceId)
        if (ws) {
          const wsSettings = workspaceSettingsMap.get(ws.id)
          if (wsSettings?.scriptArchive && pod?.cwd) {
            try {
              await orpcUtils.app.runArchiveScript.call({ script: wsSettings.scriptArchive, cwd: pod.cwd })
            } catch (err) {
              toast.error(`Archive script failed: ${err instanceof Error ? err.message : 'unknown error'}`)
            }
          }
        }
      }

      if (deleteWorktree && repoPath && worktreePath) {
        // Best-effort: if the worktree still has uncommitted changes or git
        // refuses for any other reason, surface the error but still proceed
        // with the pod delete so the user isn't stranded with an undeletable row.
        try {
          updatePendingPod(podId, { label: 'Removing worktree' })
          await orpcUtils.app.removeWorktree.call({ repoPath, directory: worktreePath })
        } catch (err) {
          toast.error(`Failed to remove worktree: ${err instanceof Error ? err.message : 'unknown error'}`)
        }
      }

      try {
        updatePendingPod(podId, { label: 'Deleting pod' })
        await client.pod.delete({ id: realId })
        removePodFromListCache(workspaceId, podId)
        clearPendingPod(podId)
      } catch (err) {
        updatePendingPod(podId, {
          label: `Delete failed: ${err instanceof Error ? err.message : 'unknown error'}`,
          status: 'failed',
        })
        toast.error(`Failed to delete pod: ${err instanceof Error ? err.message : 'unknown error'}`)
        return
      }
      invalidateAllPodLists()
    },
    [
      pendingWorktreeCleanup,
      resolveClient,
      beginExistingPodProgress,
      activePodId,
      setActivePodId,
      navigate,
      updatePendingPod,
      workspacesRaw,
      workspaceSettingsMap,
      removePodFromListCache,
      clearPendingPod,
      invalidateAllPodLists,
    ],
  )

  const handlePodDelete = useCallback(
    async (podId: string) => {
      const { client, realId } = await resolveClient(podId)
      const pod = await client.pod.getById({ id: realId })
      const gc = pod?.gitContext as { repoPath?: string; worktreePath?: string; worktreeBranch?: string } | null
      const parsed = parseNamespacedId(podId)
      const workspaceId = pod?.workspaceId
        ? parsed
          ? `remote:${parsed.registryId}:${pod.workspaceId}`
          : pod.workspaceId
        : ''

      if (!pod || !workspaceId) {
        toast.error('Failed to delete pod: pod not found')
        return
      }

      const canDeleteWorktree = !parsed && !!gc?.worktreePath && !!gc?.repoPath
      const cleanupMode = gitSettings?.['git.worktreeCleanup'] ?? 'keep'
      setPendingWorktreeCleanup({
        podId,
        podName: pod.name,
        workspaceId,
        repoPath: canDeleteWorktree ? gc.repoPath : undefined,
        worktreePath: canDeleteWorktree ? gc.worktreePath : undefined,
        defaultDeleteWorktree: canDeleteWorktree && cleanupMode === 'remove',
      })
    },
    [resolveClient, gitSettings],
  )

  const handlePodOpenInEditor = useCallback(
    async (podId: string, editorId: string) => {
      const { client, realId } = await resolveClient(podId)
      await client.pod.openInEditor({ podId: realId, editor: editorId as 'zed' | 'vscode' | 'cursor' })
    },
    [resolveClient],
  )

  const handlePodMoveToWorkspace = useCallback(
    async (podId: string, workspaceId: string) => {
      // Moving a pod only makes sense within the SAME backend. If the
      // caller passed a remote workspaceId and a local pod id (or vice
      // versa), bail — cross-backend moves are a separate feature.
      const podParsed = parseNamespacedId(podId)
      const wsParsed = parseNamespacedId(workspaceId)
      if ((podParsed?.registryId ?? null) !== (wsParsed?.registryId ?? null)) {
        toast.error('Moving a pod to a workspace on a different machine is not yet supported')
        return
      }
      const { client, realId } = await resolveClient(podId)
      const realWorkspaceId = wsParsed?.rawId ?? workspaceId
      await client.pod.update({ id: realId, workspaceId: realWorkspaceId })
      invalidateAllPodLists()
    },
    [invalidateAllPodLists, resolveClient],
  )

  const handlePodSaveAsTemplate = useCallback(
    async (podId: string, name: string, description?: string, workspaceId?: string | null) => {
      const template = await orpcUtils.template.createFromPod.call({
        podId,
        name,
        description,
        workspaceId: workspaceId ?? null,
      })
      if (template) {
        navigate({ to: '/templates/$templateId', params: { templateId: template.id } })
      }
    },
    [navigate],
  )

  const handlePodBranchOff = useCallback(
    async (podId: string) => {
      // Route through resolveClient so branch-off works for remote pods too —
      // a namespaced `remote:` id must hit the authoritative backend, not the
      // laptop's local server (which would silently return null).
      const { client, realId } = await resolveClient(podId)
      const pod = await client.pod.getById({ id: realId })
      if (!pod) return null

      const gc = pod.gitContext as { repoPath?: string; worktreePath?: string; worktreeBranch?: string } | null
      if (!gc?.worktreeBranch || !gc?.repoPath) {
        toast.error('This pod does not have a worktree branch')
        return null
      }

      try {
        const status = await client.git.getStatus({ podId: realId })
        if (status && (status.staged.length > 0 || status.unstaged.length > 0 || status.untracked.length > 0)) {
          toast.warning(
            'Commit your changes first before branching off — uncommitted changes will not carry over to the new branch.',
          )
          return null
        }
      } catch {
        // If we can't check status, warn but allow
      }

      if (!pod.workspaceId) {
        toast.error('Pod has no workspace')
        return null
      }

      // Return info so the caller can open the pod create dialog with branchFrom pre-filled
      return {
        workspaceId: pod.workspaceId,
        branchFrom: gc.worktreeBranch,
        repoPath: gc.repoPath,
      }
    },
    [resolveClient],
  )

  const handleWorkspaceRename = useCallback(
    async (workspaceId: string, name: string) => {
      const { client, realId } = await resolveClient(workspaceId)
      await client.workspace.update({ id: realId, name })
      invalidateWorkspaceList()
      // For remote workspaces, also invalidate the fan-out cache so
      // the renamed name shows up without waiting for a refetch cycle.
      const parsed = parseNamespacedId(workspaceId)
      if (parsed) {
        queryClient.invalidateQueries({ queryKey: ['remote-ws-list', parsed.registryId] as const })
      }
    },
    [invalidateWorkspaceList, queryClient, resolveClient],
  )

  const handleWorkspaceDelete = useCallback(
    async (workspaceId: string) => {
      try {
        const { client, realId } = await resolveClient(workspaceId)
        await client.workspace.delete({ id: realId })
      } catch (err) {
        toast.error(`Failed to delete workspace: ${err instanceof Error ? err.message : 'unknown error'}`)
      }
      const deletedWorkspace = workspacesRaw.find((p) => p.id === workspaceId)
      if (deletedWorkspace) {
        const podIds = new Set(podQueries[workspacesRaw.indexOf(deletedWorkspace)]?.data?.map((p) => p.id) ?? [])
        if (activePodId && podIds.has(activePodId)) {
          setActivePodId(null)
          navigate({ to: '/' })
        }
      }
      invalidateWorkspaceList()
      invalidateAllPodLists()
    },
    [
      workspacesRaw,
      podQueries,
      activePodId,
      setActivePodId,
      navigate,
      invalidateWorkspaceList,
      invalidateAllPodLists,
      resolveClient,
    ],
  )

  return {
    handleSelectPod,
    handleSelectAgent,
    handleSelectChatSession,
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
  }
}
