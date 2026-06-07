import { useHotkey } from '@tanstack/react-hotkeys'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { toast } from 'sonner'
import spinners, { type BrailleSpinnerName } from 'unicode-animations'
import { v4 as uuid } from 'uuid'
import { useAgentCommandEvents } from '@/features/agent/hooks/use-agent-command-events'
import { ASSISTANT_BAR_INSTRUCTIONS } from '@/features/agent/prompts/assistant-bar'
import {
  type AgentModel,
  type AgentSession,
  type ApprovalRequest,
  type ChatMessage,
  type CodexItem,
  useAgentStore,
} from '@/features/agent/store/agent-store'
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiCloseLine,
  RiFileEditLine,
  RiLoginCircleLine,
  RiRefreshLine,
  RiSendPlaneLine,
  RiSparklingLine,
  RiTerminalLine,
} from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { ShimmeringText } from '@/ui/shimmering-text'

const SPINNER_NAMES: BrailleSpinnerName[] = ['braille', 'helix', 'dna', 'orbit', 'breathe', 'snake', 'pulse', 'cascade']

function useRandomSpinner() {
  const [spinner] = useState(() => {
    const name = SPINNER_NAMES[Math.floor(Math.random() * SPINNER_NAMES.length)] ?? 'braille'
    return spinners[name]
  })
  return spinner
}

function BrailleSpinner({ className }: { className?: string }) {
  const spinner = useRandomSpinner()
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % spinner.frames.length)
    }, spinner.interval)
    return () => clearInterval(id)
  }, [spinner])

  return (
    <span className={className} aria-hidden>
      {spinner.frames[frame]}
    </span>
  )
}

function formatItemSummary(item: CodexItem): string {
  switch (item.type) {
    case 'commandExecution':
      return `$ ${item.command || ''}`.slice(0, 100)
    case 'fileChange': {
      const paths = item.changes?.map((c) => c.path).join(', ') || ''
      return `Edit ${paths}`
    }
    case 'mcpToolCall':
      return `${item.server || ''}:${item.tool || ''}`
    default:
      return item.type
  }
}

function ModelPicker({
  value,
  onChange,
  models,
}: {
  value: string
  onChange: (id: string) => void
  models: AgentModel[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = models.find((m) => m.id === value) ?? models[0]

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
        className="flex items-center gap-0.5 text-[10px] text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 rounded-md hover:bg-zinc-700/50 shrink-0"
      >
        {current?.label ?? value}
        <RiArrowDownSLine className="size-3" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden min-w-[160px] max-h-[200px] overflow-y-auto z-10">
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onChange(m.id)
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-zinc-700 ${
                m.id === value ? 'text-zinc-200' : 'text-zinc-400'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Extract displayable text from an MCP tool result (content[].text) or stringify fallback */
function formatItemResult(result: unknown): string {
  if (result == null) return ''
  if (typeof result === 'string') return result
  // MCP result shape: { content: [{ type: 'text', text: '...' }], structuredContent: ... }
  const obj = result as Record<string, unknown>
  if (Array.isArray(obj.content)) {
    const texts = (obj.content as { type?: string; text?: string }[])
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
    if (texts.length > 0) {
      const joined = texts.join('\n')
      // Try to pretty-print if it's JSON
      try {
        return JSON.stringify(JSON.parse(joined), null, 2)
      } catch {
        return joined
      }
    }
  }
  return JSON.stringify(result, null, 2)
}

function ItemDisplay({ item }: { item: CodexItem }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = item.type === 'commandExecution' ? RiTerminalLine : RiFileEditLine

  return (
    <div className="border border-zinc-800 rounded-md overflow-hidden text-[11px]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400"
      >
        <Icon className="size-3 shrink-0" />
        <span className="truncate">{formatItemSummary(item)}</span>
        {item.type === 'commandExecution' && item.exitCode != null && (
          <span className={`ml-auto text-[9px] ${item.exitCode === 0 ? 'text-emerald-500' : 'text-red-400'}`}>
            exit {item.exitCode}
          </span>
        )}
      </button>
      {expanded && (
        <div className="overflow-y-auto max-h-52">
          {item.type === 'mcpToolCall' && item.arguments && (
            <>
              <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-medium text-zinc-600">Code</div>
              <pre className="px-2 pb-1.5 text-zinc-400 overflow-x-auto whitespace-pre-wrap break-all border-b border-zinc-800/50">
                {typeof item.arguments === 'object'
                  ? (((item.arguments as Record<string, unknown>).code as string) ??
                    ((item.arguments as Record<string, unknown>).script as string) ??
                    JSON.stringify(item.arguments, null, 2))
                  : String(item.arguments)}
              </pre>
            </>
          )}
          {item.type === 'mcpToolCall' && (
            <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-medium text-zinc-600">Result</div>
          )}
          <pre className="px-2 pb-1.5 text-zinc-500 overflow-x-auto whitespace-pre-wrap break-all">
            {item.output ||
              formatItemResult(item.result) ||
              item.changes?.map((c) => c.diff || c.path).join('\n') ||
              'No output'}
          </pre>
        </div>
      )}
    </div>
  )
}

function PermissionDialog({
  req,
  onRespond,
  onDismiss,
}: {
  req: ApprovalRequest
  onRespond: (decision: 'accept' | 'decline') => void
  onDismiss: () => void
}) {
  return (
    <div className="mx-3 my-2 p-3 rounded-lg border border-amber-700/40 bg-amber-950/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-amber-400">Permission Request</span>
        <button
          type="button"
          onClick={onDismiss}
          className="p-0.5 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300"
          title="Dismiss"
        >
          <RiCloseLine className="size-3" />
        </button>
      </div>
      {req.command && <p className="text-xs text-zinc-300 mb-1 font-mono">$ {req.command}</p>}
      {req.grantRoot && (
        <p className="text-xs text-zinc-300 mb-1">
          Write access to: <span className="font-mono">{req.grantRoot}</span>
        </p>
      )}
      {req.reason && <p className="text-[10px] text-zinc-500 mb-3">{req.reason}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onRespond('accept')}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white text-[11px]"
        >
          <RiCheckLine className="size-3" /> Allow
        </button>
        <button
          type="button"
          onClick={() => onRespond('decline')}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-[11px]"
        >
          <RiCloseLine className="size-3" /> Deny
        </button>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.type === 'user') {
    return (
      <div className="flex justify-end px-3 py-1">
        <div className="max-w-[85%] px-3 py-1.5 rounded-2xl rounded-br-md bg-blue-600/80 text-white text-xs whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    )
  }

  if (msg.type === 'system') {
    return (
      <div className="flex justify-center px-3 py-1">
        <span className="text-[10px] text-zinc-600">{msg.content}</span>
      </div>
    )
  }

  if (msg.type === 'result') {
    return (
      <div className="flex justify-center px-3 py-1">
        <span className="text-[10px] text-zinc-600">
          {msg.result
            ? `${msg.result.inputTokens + msg.result.outputTokens} tokens · ${(msg.result.durationMs / 1000).toFixed(1)}s`
            : msg.content}
        </span>
      </div>
    )
  }

  // assistant / reasoning
  return (
    <div className="flex justify-start px-3 py-1">
      <div className="max-w-[90%] space-y-1.5">
        {msg.content && (
          <div
            className={`text-xs leading-relaxed ${msg.type === 'reasoning' ? 'text-zinc-500 italic' : 'text-zinc-200'} prose-agent`}
          >
            <Markdown>{msg.content}</Markdown>
          </div>
        )}
        {msg.streaming && !msg.content && (
          <div className="flex items-center gap-2 py-0.5">
            <BrailleSpinner className="text-amber-400 font-mono text-sm leading-none" />
            <ShimmeringText text="Thinking..." className="text-xs" />
          </div>
        )}
        {msg.items?.map((item) => (
          <ItemDisplay key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}

export function AgentCommandBar() {
  const queryClient = useQueryClient()
  const {
    session,
    messages,
    model,
    availableModels,
    agentReady,
    pendingPermission,
    authRequired,
    authUrl,
    setSession,
    setModel,
    addMessage,
    clearMessages,
    setPendingPermission,
  } = useAgentStore()
  const [expanded, setExpanded] = useState(false)
  const [message, setMessage] = useState('')
  const [spawning, setSpawning] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messageCount = messages.length

  useAgentCommandEvents()

  const open = useCallback(() => {
    if (!expanded) setExpanded(true)
  }, [expanded])

  const close = useCallback(() => {
    if (!expanded) return
    setExpanded(false)
    inputRef.current?.blur()
  }, [expanded])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    void messageCount
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messageCount])

  // Recover running sessions on mount
  const { data: sessions = [] } = useQuery(orpcUtils.agent.list.queryOptions())

  useEffect(() => {
    const running = (sessions as AgentSession[]).find((s) => s.status !== 'stopped')
    if (running && !session) {
      setSession(running)
    }
  }, [sessions, session, setSession])

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: orpcUtils.agent.list.key() })
  }, [queryClient])

  async function handleSendMessage() {
    if (!message.trim() || spawning || !agentReady || authRequired) return
    const text = message.trim()
    setMessage('')

    // Auto-start session on first message
    let target = session
    if (!target) {
      setSpawning(true)
      try {
        const cwd = await orpcUtils.app.getHomeDir.call({})
        const result = await orpcUtils.agent.startSession.call({
          cwd,
          developerInstructions: ASSISTANT_BAR_INSTRUCTIONS,
        })
        target = result as AgentSession
        setSession(target)
        invalidate()
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to start agent session')
        setSpawning(false)
        return
      }
      setSpawning(false)
    }

    // Add user message to chat
    addMessage({ id: uuid(), type: 'user', content: text })

    // Update session status optimistically
    setSession({ ...target, status: 'running' })

    // Fire the message to the agent (returns immediately, streaming via IPC)
    try {
      await orpcUtils.agent.sendMessage.call({ id: target.id, message: text, model })
    } catch (err) {
      console.error('[agent] sendMessage error:', err)
    }

    inputRef.current?.focus()
  }

  async function handleNewChat() {
    if (!session) return
    await orpcUtils.agent.stopSession.call({ id: session.id })
    setSession(null)
    clearMessages()
    setMessage('')
    setSpawning(true)
    try {
      const cwd = await orpcUtils.app.getHomeDir.call({})
      const result = await orpcUtils.agent.startSession.call({
        cwd,
        developerInstructions: ASSISTANT_BAR_INSTRUCTIONS,
      })
      const newSession = result as AgentSession
      setSession(newSession)
      invalidate()
      setTimeout(() => inputRef.current?.focus(), 50)
    } finally {
      setSpawning(false)
    }
  }

  function handlePermissionResponse(decision: 'accept' | 'decline') {
    if (!pendingPermission) return
    orpcUtils.agent.respondToPermission.call({ requestId: pendingPermission.requestId, decision })
    setPendingPermission(null)
  }

  function handleSignIn() {
    if (authUrl) {
      orpcUtils.agent.openAuth.call({ url: authUrl })
    }
  }

  // Focus textarea when expanded becomes true
  useEffect(() => {
    if (expanded) {
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
      return () => cancelAnimationFrame(id)
    }
  }, [expanded])

  // Cmd+J — open bar (Cmd+K is reserved for clear-terminal)
  useHotkey('Mod+J', (e) => {
    e.preventDefault()
    open()
  })

  // Escape to dismiss
  useHotkey('Escape', () => close(), { enabled: expanded })

  // Click outside to close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [close])

  const isRunning = session?.status === 'running'
  const hasMessages = messages.length > 0 || !!pendingPermission || isRunning
  const showPanel = expanded && (hasMessages || authRequired)

  return (
    <div className="relative shrink-0 w-[240px] h-7 no-drag">
      <motion.div
        ref={barRef}
        animate={{ width: expanded ? 440 : 240 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="absolute left-0 top-0 z-50 no-drag"
      >
        {/* Floating pill */}
        <div
          role="button"
          tabIndex={expanded ? -1 : 0}
          aria-label="Open agent command bar"
          onClick={open}
          onKeyDown={(e) => {
            if (expanded) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              open()
            }
          }}
          className={`no-drag flex items-center h-7 w-full px-2 gap-2 rounded-lg border bg-zinc-800/90 backdrop-blur-xl shadow-lg shadow-black/30 transition-colors cursor-text ${
            expanded ? 'border-zinc-700' : 'border-zinc-700/70 hover:border-zinc-700'
          }`}
        >
          <div className="size-3.5 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0">
            <RiSparklingLine className="size-2 text-white" />
          </div>

          {expanded && agentReady && !authRequired ? (
            <textarea
              ref={inputRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  close()
                }
              }}
              placeholder={isRunning ? 'Agent is working...' : 'Send a message...'}
              rows={1}
              className="flex-1 min-w-0 bg-transparent text-[11px] text-zinc-200 placeholder:text-zinc-500 outline-none resize-none leading-[20px] whitespace-nowrap overflow-x-auto"
            />
          ) : (
            <span className="flex-1 min-w-0 text-[11px] text-zinc-500 truncate leading-[20px] select-none">
              {!agentReady
                ? 'Starting agent...'
                : authRequired
                  ? 'Sign in with ChatGPT'
                  : message || 'Send a message...'}
            </span>
          )}

          <div className="flex items-center gap-1.5 shrink-0">
            {(isRunning || spawning) && (
              <BrailleSpinner className="text-amber-400 font-mono text-[11px] leading-none" />
            )}

            {/* Model picker — only shown while composing a fresh chat */}
            {expanded && agentReady && !authRequired && !hasMessages && availableModels.length > 0 && (
              <ModelPicker value={model} onChange={setModel} models={availableModels} />
            )}

            {/* Send */}
            {expanded && message.trim() && !isRunning && !spawning && !authRequired && agentReady && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleSendMessage()
                }}
                className="text-zinc-400 hover:text-zinc-200"
                title="Send"
              >
                <RiSendPlaneLine className="size-3" />
              </button>
            )}

            {/* New chat — only relevant once a session exists */}
            {expanded && session && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleNewChat()
                }}
                className="text-zinc-600 hover:text-zinc-300"
                title="New chat"
              >
                <RiRefreshLine className="size-3" />
              </button>
            )}

            {!expanded && (
              <kbd className="text-[9px] text-zinc-600 bg-zinc-900/60 px-1 rounded border border-zinc-800">
                {'\u2318'}J
              </kbd>
            )}
          </div>
        </div>

        {/* Panel — appears only when there's something to show */}
        <AnimatePresence>
          {showPanel && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="no-drag absolute top-full left-0 mt-1.5 w-full max-h-[440px] rounded-lg border border-zinc-700/80 bg-zinc-900/95 backdrop-blur-xl overflow-hidden shadow-2xl shadow-black/40 flex flex-col"
            >
              {authRequired && (
                <div className="p-3 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSignIn()
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium"
                  >
                    <RiLoginCircleLine className="size-4" />
                    Sign in with ChatGPT
                  </button>
                </div>
              )}

              {!authRequired && hasMessages && (
                <div ref={scrollRef} className="overflow-y-auto py-2 space-y-0.5">
                  {messages.map((msg) => (
                    <MessageBubble key={msg.id} msg={msg} />
                  ))}
                  {pendingPermission && (
                    <PermissionDialog
                      req={pendingPermission}
                      onRespond={handlePermissionResponse}
                      onDismiss={() => setPendingPermission(null)}
                    />
                  )}
                  {isRunning && !messages.some((m) => m.streaming) && (
                    <div className="flex items-center gap-2 px-3 py-1.5">
                      <BrailleSpinner className="text-amber-400 font-mono text-sm leading-none" />
                      <ShimmeringText text="Thinking..." className="text-xs" />
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
