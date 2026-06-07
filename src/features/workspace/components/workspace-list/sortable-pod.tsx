import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { use, useState } from 'react'
import { cn } from '@/shared/utils'
import { PodRow } from '../pod-row'
import { AgentRow } from './agent-row'
import { ChatSessionRow } from './chat-session-row'
import { WorkspaceListContext } from './context'
import { InlineRenameInput } from './inline-rename-input'
import { PodChildConnector } from './pod-child-connector'
import type { PodSummary } from './types'

export function SortablePod({
  pod,
  isSelected,
  onSelect,
  isRenaming,
  onRenameSubmit,
  onRenameCancel,
  badgePriority,
}: {
  pod: PodSummary
  isSelected: boolean
  onSelect: () => void
  isRenaming: boolean
  onRenameSubmit: (name: string) => void
  onRenameCancel: () => void
  badgePriority?: 'blocking' | 'urgent' | null
}) {
  const { selectedAgentId, onSelectAgent, selectedChatSessionItemId, onSelectChatSession } = use(WorkspaceListContext)!
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pod.id })
  const agents = pod.agents ?? []
  const chatSessions = pod.chatSessions ?? []
  const hasAgents = agents.length > 0
  const hasChatSessions = chatSessions.length > 0
  const hasChildren = hasAgents || hasChatSessions
  const [expanded, setExpanded] = useState(false)
  const hasAttention = agents.some((a) => a.needsAttention) || chatSessions.some((s) => s.needsAttention)
  const attentionAgents = agents.filter((a) => a.needsAttention)
  const nonAttentionAgents = agents.filter((a) => !a.needsAttention)
  const attentionChatSessions = chatSessions.filter((s) => s.needsAttention)
  const nonAttentionChatSessions = chatSessions.filter((s) => !s.needsAttention)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  function handlePodClick() {
    if (pod.isPending) return
    if (isSelected) {
      // Already focused — toggle expand/collapse
      if (hasChildren) setExpanded((v) => !v)
    } else {
      onSelect()
    }
  }

  const attentionFromBadge = badgePriority === 'blocking' || badgePriority === 'urgent' || hasAttention

  return (
    <div className={cn(isDragging && 'opacity-50')}>
      {/* Drag listeners only on the row itself — never on the expanded
          children below, so dragging an agent doesn't reorder the pod. */}
      <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
        <PodRow
          pod={pod}
          isSelected={isSelected && !selectedAgentId}
          attentionFromBadge={attentionFromBadge}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((v) => !v)}
          onSelect={handlePodClick}
          hasChildren={hasChildren}
          renameInput={
            isRenaming ? (
              <InlineRenameInput name={pod.name} onSubmit={onRenameSubmit} onCancel={onRenameCancel} />
            ) : undefined
          }
        />
      </div>

      {/* Child tree — PTY agents + UI-centric chat sessions share the same
          layout; attention items are always visible, the rest collapse. */}
      {hasChildren && (
        <div className="ml-2">
          {/* Attention rows (agents + chat sessions) — animated entry */}
          <div
            className="grid transition-[grid-template-rows] duration-200 ease-out ml-1.5"
            style={{ gridTemplateRows: hasAttention ? '1fr' : '0fr' }}
          >
            <div className="overflow-hidden min-h-0">
              <div className={cn('transition-opacity duration-200', hasAttention ? 'opacity-100' : 'opacity-0')}>
                {attentionAgents.map((agent, i) => {
                  const isLastInGroup = i === attentionAgents.length - 1
                  const isLast =
                    isLastInGroup &&
                    attentionChatSessions.length === 0 &&
                    (nonAttentionAgents.length + nonAttentionChatSessions.length === 0 || !expanded)
                  return (
                    <div key={agent.id} className="flex items-stretch">
                      <PodChildConnector tone="attention" isLast={isLast} />
                      <AgentRow
                        agent={agent}
                        isSelected={selectedAgentId === agent.id}
                        onSelect={() => onSelectAgent?.(pod.id, agent.id)}
                        showApproval
                      />
                    </div>
                  )
                })}
                {attentionChatSessions.map((session, i) => {
                  const isLastInGroup = i === attentionChatSessions.length - 1
                  const isLast =
                    isLastInGroup && (nonAttentionAgents.length + nonAttentionChatSessions.length === 0 || !expanded)
                  return (
                    <div key={session.id} className="flex items-stretch">
                      <PodChildConnector tone="attention" isLast={isLast} />
                      <ChatSessionRow
                        session={session}
                        isSelected={selectedChatSessionItemId === session.id}
                        onSelect={() => onSelectChatSession?.(pod.id, session.id)}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Non-attention rows (agents + chat sessions) — accordion */}
          {(nonAttentionAgents.length > 0 || nonAttentionChatSessions.length > 0) && (
            <div
              className="grid transition-[grid-template-rows] duration-200 ease-out ml-1.5"
              style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden min-h-0">
                <div className={cn('transition-opacity duration-200', expanded ? 'opacity-100' : 'opacity-0')}>
                  {nonAttentionAgents.map((agent, i) => {
                    const isLastInGroup = i === nonAttentionAgents.length - 1
                    const isLast = isLastInGroup && nonAttentionChatSessions.length === 0
                    return (
                      <div key={agent.id} className="flex items-stretch">
                        <PodChildConnector tone="default" isLast={isLast} />
                        <AgentRow
                          agent={agent}
                          isSelected={selectedAgentId === agent.id}
                          onSelect={() => onSelectAgent?.(pod.id, agent.id)}
                          showApproval={false}
                        />
                      </div>
                    )
                  })}
                  {nonAttentionChatSessions.map((session, i) => {
                    const isLast = i === nonAttentionChatSessions.length - 1
                    return (
                      <div key={session.id} className="flex items-stretch">
                        <PodChildConnector tone="default" isLast={isLast} />
                        <ChatSessionRow
                          session={session}
                          isSelected={selectedChatSessionItemId === session.id}
                          onSelect={() => onSelectChatSession?.(pod.id, session.id)}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
