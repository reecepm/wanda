import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useReviewComments, useSubmitReview } from '@/features/git/hooks/use-review'
import { useReviewStore } from '@/features/git/store/review-store'
import { ClaudeIcon, OpenAIIcon, OpenCodeIcon } from '@/features/icons'
import { AGENT_TYPES } from '@/features/pod/utils/add-item-actions'
import { createAgentItem } from '@/features/pod/utils/agent-utils'
import { getTransportFor } from '@/features/terminal/terminal-transport'
import { useViewStore } from '@/features/view/store/view-store'
import { RiCheckLine, RiTerminalLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { cn } from '@/shared/utils'
import { useUIStore } from '@/stores/ui-store'
import type { AgentType, ReviewComment } from '@/types/schema'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs'

interface SendToAgentDialogProps {
  podId: string
  branch?: string
  baseBranch?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const AGENT_ICONS: Record<AgentType, React.ComponentType<{ className?: string }>> = {
  claude: ClaudeIcon,
  codex: OpenAIIcon,
  opencode: OpenCodeIcon,
}

const AGENT_DESCRIPTIONS: Record<AgentType, string> = {
  claude: 'Anthropic Claude CLI',
  codex: 'OpenAI Codex CLI',
  opencode: 'OpenCode terminal agent',
}

// Bracketed paste sequences — modern CLI TUIs (Claude/Codex/OpenCode) recognize these
// to ingest multi-line content as a single paste rather than newline-by-newline.
const BRACKETED_PASTE_START = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'
// Delay before writing into a freshly-spawned agent terminal — gives the CLI time
// to launch and reach its prompt before the paste arrives.
const NEW_AGENT_BOOT_MS = 2500

function buildReviewMessage(comments: ReviewComment[], meta: { branch?: string; baseBranch?: string }): string {
  const grouped = new Map<string, ReviewComment[]>()
  for (const c of comments) {
    const existing = grouped.get(c.filePath) ?? []
    existing.push(c)
    grouped.set(c.filePath, existing)
  }

  let msg = '## Code Review Comments\n\n'
  if (meta.branch) {
    msg += `**Branch:** ${meta.branch}`
    if (meta.baseBranch) msg += ` → ${meta.baseBranch}`
    msg += '\n'
  }
  msg += '\n'

  for (const [filePath, fileComments] of grouped) {
    msg += `### ${filePath}\n`
    for (const c of fileComments) {
      const lineRef = c.endLine ? `Lines ${c.startLine}-${c.endLine}` : `Line ${c.startLine}`
      msg += `- **${lineRef} (${c.side}):** ${c.body}\n`
    }
    msg += '\n'
  }

  msg += '---\nPlease address each comment above. For each one, explain your approach and make the fix.\n'
  return msg
}

function pasteIntoPty(ptyInstanceId: string, message: string) {
  const transport = getTransportFor(ptyInstanceId)
  const payload = BRACKETED_PASTE_START + message + BRACKETED_PASTE_END
  transport.write(ptyInstanceId, payload)
  setTimeout(() => {
    transport.write(ptyInstanceId, '\r')
  }, 50)
}

export function SendToAgentDialog({ podId, branch, baseBranch, open, onOpenChange }: SendToAgentDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const activeReviewId = useReviewStore((s) => s.activeReviewId)
  const { comments } = useReviewComments(activeReviewId)
  // Sending to an agent = the review is "done" → freeze it server-side so a
  // fresh draft gets created next time.
  const submitReview = useSubmitReview(podId)

  const finalizeReviewAfterSend = useCallback(async () => {
    if (!activeReviewId) return
    try {
      await submitReview.mutateAsync({ reviewId: activeReviewId })
    } catch (err) {
      console.error('[review] failed to finalize review after send:', err)
    }
  }, [activeReviewId, submitReview])

  const { data: runningAgents = [] } = useQuery({
    ...orpcUtils.pod.runningAgents.queryOptions({ input: { podId } }),
    enabled: open,
    refetchInterval: open ? 3000 : false,
  })

  const [tab, setTab] = useState<'new' | 'existing'>('new')
  const [sending, setSending] = useState(false)
  const [selectedExistingId, setSelectedExistingId] = useState<string | null>(null)

  const preview = useMemo(() => buildReviewMessage(comments, { branch, baseBranch }), [comments, branch, baseBranch])

  const fileCount = useMemo(() => new Set(comments.map((c) => c.filePath)).size, [comments])

  const focusItemInPod = useCallback(
    (itemId: string, ptyInstanceId: string) => {
      const view = useViewStore.getState()
      const entity = view.entities[podId]
      const activeView = entity?.views.find((v) => v.id === entity.activeViewId)
      if (activeView && !activeView.itemSettings[itemId]) {
        view.splitPane('horizontal', itemId)
      }
      view.setActiveItem(itemId)
      useUIStore.getState().setSelected(ptyInstanceId)
    },
    [podId],
  )

  const handleSendNew = useCallback(
    async (agentType: AgentType) => {
      setSending(true)
      try {
        const message = buildReviewMessage(comments, { branch, baseBranch })

        await orpcUtils.pod.ensureStarted.call({ id: podId })

        const item = await createAgentItem(podId, agentType, { isRunning: true })
        if (!item) throw new Error('Failed to create agent')

        const running = (await orpcUtils.pod.runningAgents.call({ podId })) as Array<{
          podAgentId: string
          podTerminalId: string
          ptyInstanceId: string
          agentType: string
        }>
        const fresh = running.find(
          (a) => a.agentType === agentType && a.podAgentId === (item.config as { podAgentId: string }).podAgentId,
        )
        if (!fresh) throw new Error('New agent terminal not running yet')

        focusItemInPod(item.id, fresh.ptyInstanceId)

        await new Promise((r) => setTimeout(r, NEW_AGENT_BOOT_MS))
        pasteIntoPty(fresh.ptyInstanceId, message)

        await finalizeReviewAfterSend()
        onOpenChange(false)
        toast.success(`Review sent to new ${agentType} agent`)
        queryClient.invalidateQueries({ queryKey: orpcUtils.podItem.list.key({ input: { podId } }) })
        navigate({ to: '/pods/$podId', params: { podId } })
      } catch (err) {
        console.error('[review] send to new agent error:', err)
        toast.error(err instanceof Error ? err.message : 'Failed to spawn agent')
      } finally {
        setSending(false)
      }
    },
    [comments, branch, baseBranch, podId, finalizeReviewAfterSend, onOpenChange, queryClient, navigate, focusItemInPod],
  )

  const handleSendExisting = useCallback(async () => {
    if (!selectedExistingId) return
    setSending(true)
    try {
      const target = runningAgents.find((a) => a.podAgentId === selectedExistingId)
      if (!target) throw new Error('Selected agent is no longer running')

      const entity = useViewStore.getState().entities[podId]
      const podItem = entity?.podItems.find(
        (i) => i.contentType === 'agent' && (i.config as { podAgentId: string }).podAgentId === target.podAgentId,
      )
      if (podItem) focusItemInPod(podItem.id, target.ptyInstanceId)
      else useUIStore.getState().setSelected(target.ptyInstanceId)

      const message = buildReviewMessage(comments, { branch, baseBranch })
      pasteIntoPty(target.ptyInstanceId, message)

      await finalizeReviewAfterSend()
      onOpenChange(false)
      toast.success(`Review sent to ${target.name}`)
      navigate({ to: '/pods/$podId', params: { podId } })
    } catch (err) {
      console.error('[review] send to existing agent error:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to send review')
    } finally {
      setSending(false)
    }
  }, [
    selectedExistingId,
    runningAgents,
    comments,
    branch,
    baseBranch,
    finalizeReviewAfterSend,
    onOpenChange,
    navigate,
    podId,
    focusItemInPod,
  ])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>Send Review Comments</DialogTitle>
          <DialogDescription>
            {comments.length} comment{comments.length !== 1 ? 's' : ''} across {fileCount} file
            {fileCount !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Message Preview</span>
          <div className="max-h-32 overflow-y-auto rounded-md bg-zinc-900 border border-zinc-800 p-3">
            <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed">{preview}</pre>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'new' | 'existing')}>
          <TabsList className="w-full">
            <TabsTrigger value="new">New session</TabsTrigger>
            <TabsTrigger value="existing">
              Existing agent
              {runningAgents.length > 0 && (
                <span className="ml-1 text-[9px] text-zinc-500">({runningAgents.length})</span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="mt-2">
            <div className="grid grid-cols-3 gap-2">
              {AGENT_TYPES.map(({ id, label }) => {
                const Icon = AGENT_ICONS[id]
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={sending}
                    onClick={() => handleSendNew(id)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 px-2 py-3 rounded-md border border-zinc-800 bg-zinc-900/40',
                      'hover:border-purple-500/40 hover:bg-purple-500/5 transition-colors',
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                    )}
                  >
                    <Icon className="size-5 text-zinc-300" />
                    <span className="text-[11px] font-medium text-zinc-200">{label}</span>
                    <span className="text-[9px] text-zinc-500 text-center">{AGENT_DESCRIPTIONS[id]}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-zinc-600 mt-2">
              Spawns a new agent terminal in this pod and pastes the review automatically.
            </p>
          </TabsContent>

          <TabsContent value="existing" className="mt-2">
            {runningAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 py-6 text-center">
                <RiTerminalLine className="size-5 text-zinc-700" />
                <span className="text-[11px] text-zinc-500">No running agents in this pod</span>
                <span className="text-[10px] text-zinc-600">Switch to "New session" to spawn one</span>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                {runningAgents.map((agent) => {
                  const Icon = AGENT_ICONS[agent.agentType as AgentType] ?? RiTerminalLine
                  const selected = selectedExistingId === agent.podAgentId
                  return (
                    <button
                      key={agent.podAgentId}
                      type="button"
                      disabled={sending}
                      onClick={() => setSelectedExistingId(agent.podAgentId)}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-2 rounded-md border text-left transition-colors',
                        selected
                          ? 'border-purple-500/50 bg-purple-500/10'
                          : 'border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800/50',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                      )}
                    >
                      <Icon className="size-4 text-zinc-300 shrink-0" />
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <span className="text-[11px] font-medium text-zinc-200 truncate">{agent.name}</span>
                        <span className="text-[9px] text-zinc-500 capitalize">{agent.agentType}</span>
                      </div>
                      <span className="flex items-center gap-1 shrink-0">
                        <span className="size-1.5 rounded-full bg-emerald-400" />
                        <span className="text-[9px] text-emerald-400">running</span>
                      </span>
                      {selected && <RiCheckLine className="size-3.5 text-purple-300 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          {tab === 'existing' && (
            <Button onClick={handleSendExisting} disabled={sending || !selectedExistingId || comments.length === 0}>
              {sending ? 'Sending...' : `Send to selected agent`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
