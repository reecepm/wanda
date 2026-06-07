import { useEffect } from 'react'
import { v4 as uuid } from 'uuid'
import {
  type AgentProviderModel,
  onAgentAuthRequired,
  onAgentMessage,
  onAgentModelsLoaded,
  onAgentPermissionRequest,
  onAgentPermissionResolved,
  onAgentReady,
} from '@/features/agent/agent-events'
import { type AgentModel, type AgentSession, type CodexItem, useAgentStore } from '@/features/agent/store/agent-store'
import { orpcUtils } from '@/shared/orpc'

type AgentMessageItem = Partial<CodexItem> & {
  type?: CodexItem['type'] | 'userMessage' | 'contextCompaction'
  summary?: unknown
  aggregatedOutput?: string
}

interface AgentMessagePayload {
  method: string
  params: {
    item?: AgentMessageItem
    itemId?: string
    delta?: string
    turn?: { status?: AgentSession['status'] | 'completed' | 'interrupted' }
  }
}

function normalizeModelLabel(raw: string | undefined): string {
  if (!raw) return ''
  return raw
    .replace(/^gpt-/i, 'GPT-')
    .replace(/-mini\b/gi, ' Mini')
    .replace(/-codex\b/gi, ' Codex')
    .replace(/-spark\b/gi, ' Spark')
    .replace(/\bmini\b/gi, 'Mini')
    .replace(/\bcodex\b/gi, 'Codex')
    .replace(/\bspark\b/gi, 'Spark')
    .replace(/\bnano\b/gi, 'Nano')
}

function toAgentModels(models: AgentProviderModel[]): AgentModel[] {
  return models.map((model) => ({ id: model.id, label: normalizeModelLabel(model.displayName || model.id) }))
}

export function useAgentCommandEvents() {
  const {
    session,
    setSession,
    setAvailableModels,
    addMessage,
    startStreamingMessage,
    appendStreamingText,
    finalizeStreamingMessage,
    setPendingPermission,
    setAuthRequired,
  } = useAgentStore()
  const activeSessionId = session?.id

  useEffect(() => {
    if (!activeSessionId) return

    const itemAccum = new Map<string, CodexItem>()

    const removeMsgListener = onAgentMessage((sessionId, rawMsg) => {
      if (sessionId !== activeSessionId) return
      const msg = rawMsg as AgentMessagePayload

      switch (msg.method) {
        case 'turn/started': {
          break
        }

        case 'item/started': {
          const item = msg.params.item
          if (item?.type === 'agentMessage') {
            startStreamingMessage(item.id || uuid())
          } else if (item?.type === 'commandExecution') {
            if (!item.id) break
            itemAccum.set(item.id, {
              type: 'commandExecution',
              id: item.id,
              command: item.command,
              cwd: item.cwd,
              output: '',
            })
          } else if (item?.type === 'fileChange') {
            if (!item.id) break
            itemAccum.set(item.id, {
              type: 'fileChange',
              id: item.id,
              changes: item.changes,
            })
          } else if (item?.type === 'mcpToolCall') {
            if (!item.id) break
            itemAccum.set(item.id, {
              type: 'mcpToolCall',
              id: item.id,
              server: item.server,
              tool: item.tool,
              arguments: item.arguments,
            })
          }
          break
        }

        case 'item/agentMessage/delta': {
          appendStreamingText(msg.params.delta || '')
          break
        }

        case 'item/commandExecution/outputDelta': {
          const itemId = msg.params.itemId
          if (!itemId) break
          const existing = itemAccum.get(itemId)
          if (existing) {
            existing.output = (existing.output || '') + (msg.params.delta || '')
          }
          break
        }

        case 'item/completed': {
          const item = msg.params.item
          if (!item) break

          if (item.type === 'agentMessage') {
            const store = useAgentStore.getState()
            if (store._streamingId) {
              finalizeStreamingMessage(item.text || '')
            }
          } else if (item.type === 'reasoning') {
            const text = Array.isArray(item.summary) ? item.summary.join('\n') : ''
            if (text && item.id) {
              addMessage({ id: item.id, type: 'reasoning', content: text })
            }
          } else if (item.type === 'commandExecution' || item.type === 'fileChange' || item.type === 'mcpToolCall') {
            if (!item.id) break
            const accum = itemAccum.get(item.id)
            const completedItem: CodexItem = {
              type: item.type,
              id: item.id,
              command: item.command || accum?.command,
              cwd: item.cwd || accum?.cwd,
              exitCode: item.exitCode,
              output: accum?.output || item.aggregatedOutput,
              changes: item.changes || accum?.changes,
              server: item.server || accum?.server,
              tool: item.tool || accum?.tool,
              arguments: item.arguments || accum?.arguments,
              result: item.result,
            }
            itemAccum.delete(item.id)
            addMessage({
              id: item.id,
              type: 'assistant',
              content: '',
              items: [completedItem],
            })
          }
          break
        }

        case 'item/reasoning/summaryTextDelta': {
          appendStreamingText(msg.params.delta || '')
          break
        }

        case 'turn/completed': {
          const turn = msg.params.turn
          const status = turn?.status || 'completed'
          const store = useAgentStore.getState()
          if (store._streamingId) {
            const streamMsg = store.messages.find((message) => message.id === store._streamingId)
            finalizeStreamingMessage(streamMsg?.content || '')
          }

          if (status === 'completed' || status === 'interrupted') {
            const currentSession = useAgentStore.getState().session
            if (currentSession?.id === activeSessionId) {
              setSession({ ...currentSession, status: 'idle' })
            }
          }
          itemAccum.clear()
          break
        }

        case 'thread/tokenUsage/updated': {
          break
        }
      }
    })

    const removePermListener = onAgentPermissionRequest(setPendingPermission)
    const removeResolvedListener = onAgentPermissionResolved(() => {
      setPendingPermission(null)
    })

    return () => {
      removeMsgListener()
      removePermListener()
      removeResolvedListener()
    }
  }, [
    activeSessionId,
    addMessage,
    appendStreamingText,
    finalizeStreamingMessage,
    setPendingPermission,
    setSession,
    startStreamingMessage,
  ])

  useEffect(() => {
    const removeAuthListener = onAgentAuthRequired((authUrl) => {
      setAuthRequired(true, authUrl)
    })
    return () => {
      removeAuthListener()
    }
  }, [setAuthRequired])

  useEffect(() => {
    let disposed = false

    const removeModelsListener = onAgentModelsLoaded((models) => {
      setAvailableModels(toAgentModels(models))
    })
    const removeReadyListener = onAgentReady(() => {
      useAgentStore.getState().setAgentReady(true)
    })

    orpcUtils.agent.getState.call({}).then((state) => {
      if (disposed) return
      if (state.models) {
        setAvailableModels(toAgentModels(state.models))
      }
      if (state.authUrl) {
        setAuthRequired(true, state.authUrl)
      }
      if (state.ready) {
        useAgentStore.getState().setAgentReady(true)
      }
    })

    return () => {
      disposed = true
      removeModelsListener()
      removeReadyListener()
    }
  }, [setAvailableModels, setAuthRequired])
}
