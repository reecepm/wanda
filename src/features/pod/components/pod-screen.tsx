import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GitDiffPill, GitOverlay } from '@/features/git'
import { EditorIcon } from '@/features/icons'
import { type PodAction, setPodActionCallback, useShortcuts } from '@/features/shortcuts/use-shortcuts'
import {
  registerRemotePodScope,
  registerRemoteTerminal,
  unregisterRemotePodScope,
  unregisterRemoteTerminal,
} from '@/features/terminal/terminal-transport'
import { ActiveViewRenderer } from '@/features/view/components/active-view-renderer'
import { ItemPicker } from '@/features/view/components/item-picker'
import { ViewTabStrip } from '@/features/view/components/view-tab-strip'
import { VIEW_SCOPE_CONFIGS, ViewScopeProvider } from '@/features/view/scope'
import { useViewCallbacks } from '@/features/view/store/view-callbacks'
import { useActiveView, useViewStore } from '@/features/view/store/view-store'
import { ContentTopBar } from '@/layout/content-top-bar'
import { RiArrowDownSLine, RiLoader4Line, RiPlayFill, RiRestartLine, RiStopFill } from '@/lib/icons'
import { orpcForPod, orpcUtils, registerPodClient, unregisterPodClient, unwrapPodId } from '@/shared/orpc'
import type { CommandItemConfig } from '@/types/schema'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import { Button } from '@/ui/button'
import { ButtonGroup } from '@/ui/button-group'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { useCloseConfirmation } from '../hooks/use-close-confirmation'
import { usePodActions } from '../hooks/use-pod-actions'
import { usePodData } from '../hooks/use-pod-data'
import { usePodLifecycle } from '../hooks/use-pod-lifecycle'
import { useAddItemActions } from '../utils/add-item-actions'
import { POD_STATUS_COLORS, POD_STATUS_LABELS } from '../utils/pod-status'
import { AddCommandDialog } from './add-command-dialog'
import { CommandsPopover } from './commands-popover'

export function PodScreen({ podId, isTemplate }: { podId: string; isTemplate?: boolean }) {
  const queryClient = useQueryClient()

  const data = usePodData(podId, isTemplate)
  const {
    pod,
    status,
    isTransitioning,
    podIsLocalPty,
    terminalConfigs,
    terminalConfigsStatus,
    runningTerminals,
    commandConfigs,
    runningCommands,
    podItemsList,
    podItemsStatus,
    podViews,
    detectedEditors,
    defaultEditor,
    active,
  } = data

  const actions = usePodActions(podId, status, isTransitioning)
  const { error, invalidatePod, handleStart, handleStop, handleRestart, handleOpenInEditor } = actions

  usePodLifecycle({
    podId,
    isTemplate,
    pod,
    terminalConfigs,
    terminalConfigsStatus,
    commandConfigs,
    podItemsList,
    podItemsStatus,
    podViews,
    invalidatePod,
    active,
  })

  const [gitPanelOpen, setGitPanelOpen] = useState(false)
  const [addCmdDialogOpen, setAddCmdDialogOpen] = useState(false)

  useShortcuts()

  const activeView = useActiveView()
  void activeView
  void podItemsList
  const storeState = useViewStore.getState()
  const storePod = storeState.activeEntityId ? storeState.entities[storeState.activeEntityId] : undefined
  const pickerCommandIdsInView = new Set(
    (storePod?.podItems ?? [])
      .filter((pi) => pi.contentType === 'command')
      .map((pi) => (pi.config as CommandItemConfig).podCommandId),
  )

  const pickerPlaceItem = useCallback((item: { id: string }) => {
    const placeFn = useViewCallbacks.getState().viewPlaceItem
    if (placeFn) placeFn(item.id)
    else useViewStore.getState().splitPane('horizontal', item.id)
  }, [])

  const pickerActions = useAddItemActions({
    podId,
    isRunning: status === 'running',
    terminalCount: terminalConfigs.length,
    commandConfigs,
    commandIdsInView: pickerCommandIdsInView,
    placeItem: pickerPlaceItem,
    onItemsChanged: invalidatePod,
    onNewCommand: () => setAddCmdDialogOpen(true),
  })

  const onTerminalRemoved = useCallback(
    (podTerminalId: string) => {
      queryClient.setQueryData(orpcUtils.pod.listTerminals.queryKey({ input: { podId } }), (old) =>
        old?.filter((t) => t.id !== podTerminalId),
      )
      queryClient.setQueryData(orpcUtils.pod.runningTerminals.queryKey({ input: { id: podId } }), (old) =>
        old?.filter((t) => t.podTerminalId !== podTerminalId),
      )
      queryClient.setQueryData(orpcUtils.podItem.list.queryKey({ input: { podId } }), (old) =>
        old?.filter((pi) => (pi.config as { podTerminalId?: string })?.podTerminalId !== podTerminalId),
      )
    },
    [podId, queryClient],
  )

  // When the active pod lives on a paired remote server, publish the
  // paired RPC client under this pod's namespaced id so every write in
  // the subtree (view-store persistence, agent creation, pod-item CRUD)
  // automatically routes to the remote via `orpcForPod(podId)`. Must run
  // synchronously during render because child effects may fire a mutation
  // before our own effects land. Cleanup on unmount drops the entry.
  useMemo(() => {
    if (active?.kind === 'remote' && active.client) {
      registerPodClient(podId, active.client)
    }
  }, [podId, active?.kind, active?.client])
  useEffect(() => {
    if (active?.kind !== 'remote' || !active.client) return
    // Capture the client so cleanup only removes our own entry — if a
    // fast A → B navigation on the same server remaps `podClients[A]`
    // to B's client between our register and our cleanup, we must not
    // clobber it.
    const owned = active.client
    return () => unregisterPodClient(podId, owned)
  }, [podId, active?.kind, active?.client])

  // Claim this pod's terminals for the paired-server bridge when the pod
  // is remote. MUST happen synchronously during render (not in useEffect)
  // because child TerminalView effects — which call
  // `TerminalRegistry.acquire()` → `getTransportFor(ptyId)` — fire
  // BEFORE parent useEffects. `terminalRegistry.acquire` also captures
  // the transport the FIRST time a ptyInstanceId is seen and never
  // re-reads, so missing the initial race silently locks every
  // pre-existing terminal onto the local transport for the rest of the
  // pod-page's lifetime.
  //
  // Two layers of defense:
  //   1. Pod scope — registered unconditionally on every render while
  //      this pod is remote, keyed by the namespaced podId. Covers
  //      terminals that mount before `pod.listTerminals` /
  //      `pod.runningTerminals` resolve.
  //   2. Per-terminal ids — populated once the queries land, so later
  //      navigations (or cross-pod scope overlap) resolve deterministically.
  //
  // We register ids by `ptyInstanceId` (what TerminalView actually passes
  // to acquire) AND `terminalConfig.id` / `podTerminalId` — the view may
  // briefly mount a pty that's in a transitional state.
  useMemo(() => {
    if (active?.kind !== 'remote' || !active.registryId) return
    registerRemotePodScope(podId, active.registryId)
    for (const t of terminalConfigs) registerRemoteTerminal(t.id, active.registryId)
    for (const r of runningTerminals) {
      registerRemoteTerminal(r.ptyInstanceId, active.registryId)
      registerRemoteTerminal(r.podTerminalId, active.registryId)
    }
  }, [podId, active?.kind, active?.registryId, terminalConfigs, runningTerminals])

  // Scope cleanup runs on pod-page unmount / pod change ONLY. Previously
  // the cleanup was tied to every deps change on `terminalConfigs`, which
  // made the cleanup fire on every query refetch — clearing the scope
  // between a child's `acquire` call and its later `getScrollback` /
  // `onData` subscription and routing them to the local transport
  // silently. Scoping the cleanup to `podId + active?.kind` keeps the
  // scope alive for the full lifetime of the pod-page view.
  useEffect(() => {
    if (active?.kind !== 'remote') return
    return () => unregisterRemotePodScope(podId)
  }, [podId, active?.kind])

  // Per-terminal cleanup: when the set of terminals actually changes we
  // drop the stale explicit entries. Safe to fire on every refetch
  // because the scope above still covers newly-mounting children until
  // their per-terminal entry lands again in the next useMemo.
  useEffect(() => {
    if (active?.kind !== 'remote') return
    const ids = [
      ...terminalConfigs.map((t) => t.id),
      ...runningTerminals.flatMap((r) => [r.ptyInstanceId, r.podTerminalId]),
    ]
    return () => {
      for (const id of ids) unregisterRemoteTerminal(id)
    }
  }, [active?.kind, terminalConfigs, runningTerminals])

  useEffect(() => {
    const cb = (action: PodAction) => {
      if (action === 'stop') handleStop()
      else if (action === 'restart') handleRestart()
      else if (action === 'open-in-editor') {
        if (defaultEditor) handleOpenInEditor(defaultEditor.id)
      }
    }
    setPodActionCallback(cb)
    return () => setPodActionCallback(null)
  }, [handleStop, handleRestart, handleOpenInEditor, defaultEditor])

  // Pod data is preloaded at app bootstrap so on first mount `pod` is almost
  // always populated. This fallback only trips briefly for newly-created pods
  // before the refetch lands — render an empty shell rather than a jarring
  // "Loading pod..." message.
  if (!pod) {
    return <div className="h-full" />
  }

  return (
    <ViewScopeProvider value={{ config: VIEW_SCOPE_CONFIGS.pod, scope: 'pod', entityId: podId }}>
      <div
        className="flex flex-col h-full"
        data-wanda-pod-page=""
        data-wanda-pod-id={podId}
        data-wanda-pod-kind={active?.kind ?? 'local'}
      >
        <ContentTopBar>
          <ContentTopBar.Left>
            {isTemplate && (
              <span className="text-[10px] font-medium text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">TEMPLATE</span>
            )}
            {/* Local pods hide the status dot in normal states (pre-started at bootstrap);
              only 'failed' surfaces so the user knows something's wrong. */}
            {!isTemplate && (!podIsLocalPty || status === 'failed') && (
              <span className={`h-2 w-2 rounded-full shrink-0 ${POD_STATUS_COLORS[status]}`} />
            )}
            {!isTemplate && (!podIsLocalPty || status === 'failed') && (
              <span className="text-[11px] text-zinc-600">{POD_STATUS_LABELS[status]}</span>
            )}
          </ContentTopBar.Left>
          <ContentTopBar.Right>
            <ViewTabStrip podId={podId} />
            {!isTemplate && (!podIsLocalPty || status === 'failed') && <div className="h-4 w-px bg-zinc-800 mx-1.5" />}
            {isTemplate ? null : podIsLocalPty && status !== 'failed' ? null : isTransitioning ? (
              <RiLoader4Line className="h-4 w-4 text-zinc-500 animate-spin" />
            ) : status === 'stopped' || status === 'failed' ? (
              <button
                type="button"
                onClick={handleStart}
                className="p-1 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-emerald-400 transition-colors"
                title="Start"
              >
                <RiPlayFill className="h-4 w-4" />
              </button>
            ) : status === 'running' ? (
              <>
                <button
                  type="button"
                  onClick={handleRestart}
                  className="p-1 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-amber-400 transition-colors"
                  title="Restart"
                >
                  <RiRestartLine className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  className="p-1 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-red-400 transition-colors"
                  title="Stop"
                >
                  <RiStopFill className="h-4 w-4" />
                </button>
              </>
            ) : null}
            <div className="h-4 w-px bg-zinc-800 mx-1.5" />
            <CommandsPopover
              podId={podId}
              podCwd={pod?.cwd ?? ''}
              commandConfigs={commandConfigs}
              runningCommands={runningCommands}
              onChanged={invalidatePod}
              isTemplate={isTemplate}
            />
            {!isTemplate && (
              <>
                <GitDiffPill podId={podId} active={gitPanelOpen} onClick={() => setGitPanelOpen(!gitPanelOpen)} />
                {defaultEditor &&
                  (detectedEditors.length > 1 ? (
                    <ButtonGroup>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleOpenInEditor(defaultEditor.id)}
                        title={`Open in ${defaultEditor.name}`}
                        aria-label={`Open in ${defaultEditor.name}`}
                      >
                        <EditorIcon id={defaultEditor.id} iconDataUrl={defaultEditor.iconDataUrl} className="size-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="outline" size="icon-xs" title="Choose editor" aria-label="Choose editor" />
                          }
                        >
                          <RiArrowDownSLine />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" side="bottom">
                          {detectedEditors.map((editor) => (
                            <DropdownMenuItem key={editor.id} onClick={() => handleOpenInEditor(editor.id)}>
                              <EditorIcon id={editor.id} iconDataUrl={editor.iconDataUrl} className="size-4.5" />
                              {editor.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ButtonGroup>
                  ) : (
                    <Button
                      variant="outline"
                      size="icon-xs"
                      onClick={() => handleOpenInEditor(defaultEditor.id)}
                      title={`Open in ${defaultEditor.name}`}
                      aria-label={`Open in ${defaultEditor.name}`}
                    >
                      <EditorIcon id={defaultEditor.id} iconDataUrl={defaultEditor.iconDataUrl} className="size-4" />
                    </Button>
                  ))}
              </>
            )}
          </ContentTopBar.Right>
        </ContentTopBar>

        {error && (
          <div className="text-[10px] px-3 py-1 bg-red-950/50 border-b border-red-800/50 text-red-300">{error}</div>
        )}

        <ActiveViewRenderer
          podId={podId}
          podStatus={isTemplate ? 'stopped' : status}
          isTemplate={isTemplate}
          runningTerminals={runningTerminals}
          terminalConfigs={terminalConfigs}
          commandConfigs={commandConfigs}
          runningCommands={runningCommands}
          onTerminalsChanged={invalidatePod}
          onNewCommand={() => setAddCmdDialogOpen(true)}
          onTerminalRemoved={onTerminalRemoved}
        />

        {!isTemplate && gitPanelOpen && <GitOverlay podId={podId} onClose={() => setGitPanelOpen(false)} />}

        <ItemPicker actions={pickerActions} />
        <AddCommandDialog
          open={addCmdDialogOpen}
          onOpenChange={setAddCmdDialogOpen}
          podCwd={pod?.cwd ?? ''}
          isTemplate={isTemplate}
          onSubmit={async (data) => {
            await orpcForPod(podId).pod.addCommand({ podId: unwrapPodId(podId), ...data })
            invalidatePod()
          }}
        />
        <CloseAgentConfirmDialog />
      </div>
    </ViewScopeProvider>
  )
}

function CloseAgentConfirmDialog() {
  const pending = useCloseConfirmation((s) => s.pending)
  const setPending = useCloseConfirmation((s) => s.setPending)

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null)
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title ?? 'Agent is running'}</AlertDialogTitle>
          <AlertDialogDescription>
            {pending?.description ?? `"${pending?.label}" is still running. Stop the agent and close?`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => pending?.onConfirm()}>
            {pending?.confirmLabel ?? 'Stop & Close'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
