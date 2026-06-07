import { useCallback, useState } from 'react'
import { RiArrowDownSLine, RiSendPlaneLine } from '@/lib/icons'
import { cn } from '@/shared/utils'
import { Button } from '@/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Textarea } from '@/ui/textarea'
import { useTrayActions } from '../hooks/use-tray-actions'
import { useTrayData } from '../hooks/use-tray-data'
import { useTrayStore } from '../tray-store'
import { AgentTypePicker } from './agent-type-picker'
import { WorkspacePicker } from './workspace-picker'

export function TrayQuickInput() {
  const launchMode = useTrayStore((s) => s.launchMode)
  const setLaunchMode = useTrayStore((s) => s.setLaunchMode)
  const selectedPodId = useTrayStore((s) => s.selectedPodId)
  const setSelectedPodId = useTrayStore((s) => s.setSelectedPodId)
  const promptText = useTrayStore((s) => s.promptText)
  const setPromptText = useTrayStore((s) => s.setPromptText)
  const selectedAgentType = useTrayStore((s) => s.selectedAgentType)
  const setSelectedAgentType = useTrayStore((s) => s.setSelectedAgentType)
  const selectedWorkspaceId = useTrayStore((s) => s.selectedWorkspaceId)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { createPodWithAgent, spawnAgentForPod } = useTrayActions()
  const { workspaces } = useTrayData()

  // All pods in the selected workspace (for existing-pod mode)
  const selectedWorkspace = workspaces.find((ws) => ws.id === selectedWorkspaceId)
  const workspacePods = selectedWorkspace?.pods ?? []

  const submit = useCallback(async () => {
    if (!promptText.trim() || isSubmitting) return
    setIsSubmitting(true)
    try {
      if (launchMode === 'new-pod') {
        if (!selectedWorkspaceId) return
        await createPodWithAgent({
          workspaceId: selectedWorkspaceId,
          prompt: promptText,
          agentType: selectedAgentType,
        })
      } else {
        if (!selectedPodId) return
        await spawnAgentForPod({
          podId: selectedPodId,
          prompt: promptText,
          agentType: selectedAgentType,
        })
      }
      setPromptText('')
    } catch (err) {
      console.error('[tray] submit failed:', err)
    } finally {
      setIsSubmitting(false)
    }
  }, [
    launchMode,
    promptText,
    selectedAgentType,
    selectedWorkspaceId,
    selectedPodId,
    isSubmitting,
    createPodWithAgent,
    spawnAgentForPod,
    setPromptText,
  ])

  return (
    <div className="shrink-0 border-t border-border/50 px-2 py-2">
      <div className="flex flex-col gap-1.5">
        {/* Workspace picker (always visible) */}
        <WorkspacePicker />

        {/* Pod picker (only in existing-pod mode) */}
        {launchMode === 'existing-pod' && (
          <Select value={selectedPodId ?? ''} onValueChange={(val) => setSelectedPodId(val as string)}>
            <SelectTrigger size="sm" className="w-full text-[11px]">
              <SelectValue placeholder="Select pod...">
                {(value: string | null) => {
                  const pod = workspacePods.find((p) => p.id === value)
                  return pod?.name ?? 'Select pod...'
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {workspacePods.length === 0 ? (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">No pods in this workspace</div>
              ) : (
                workspacePods.map((pod) => (
                  <SelectItem key={pod.id} value={pod.id}>
                    {pod.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        )}

        <AgentTypePicker value={selectedAgentType} onChange={setSelectedAgentType} />

        {/* Prompt textarea */}
        <Textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={launchMode === 'new-pod' ? 'Describe what to build...' : 'What should the agent do...'}
          rows={3}
          className="min-h-[72px] max-h-[120px] overflow-y-auto text-[11px]"
        />

        {/* Split button: main action + mode switcher dropdown */}
        <div className="flex">
          <Button
            size="xs"
            onClick={() => submit()}
            disabled={isSubmitting || !promptText.trim() || (launchMode === 'existing-pod' && !selectedPodId)}
            className="flex-1 rounded-r-none"
          >
            <RiSendPlaneLine data-icon="inline-start" className="size-3" />
            {launchMode === 'new-pod' ? 'Create pod' : 'Spawn in pod'}
          </Button>

          {/* Menu toggle */}
          <div className="relative">
            <Button
              size="xs"
              onClick={() => setMenuOpen(!menuOpen)}
              className="rounded-l-none border-l border-l-primary-foreground/20 px-1"
            >
              <RiArrowDownSLine className="size-3.5" />
            </Button>

            {menuOpen && (
              <>
                {/* Backdrop to close */}
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute bottom-full right-0 z-50 mb-1 w-40 rounded-md border border-border bg-popover p-1 shadow-md">
                  <ModeOption
                    label="New pod"
                    active={launchMode === 'new-pod'}
                    onClick={() => {
                      setLaunchMode('new-pod')
                      setMenuOpen(false)
                    }}
                  />
                  <ModeOption
                    label="Existing pod"
                    active={launchMode === 'existing-pod'}
                    onClick={() => {
                      setLaunchMode('existing-pod')
                      setMenuOpen(false)
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ModeOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center rounded-sm px-2 py-1 text-[11px] transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50',
      )}
    >
      {label}
    </button>
  )
}
