import { SessionIdSchema } from '@wanda/agent-protocol'
import { memo } from 'react'
import { AgentSessionContainer } from '@/features/agent-session'
import { MarkdownEditorContent } from '@/features/markdown-editor'
import { TerminalView } from '@/features/terminal'
import { useTerminalRender } from '@/features/view/terminal-render-context'
import { RiFileTextLine, RiTerminalLine } from '@/lib/icons'
import type {
  AgentItemConfig,
  AgentSessionItemConfig,
  BrowserItemConfig,
  CommandItemConfig,
  MarkdownItemConfig,
  TerminalItemConfig,
  ViewItem,
} from '@/types/schema'
import { AgentStoppedView } from './agent-stopped-view'
import { BrowserViewContent } from './browser-view-content'
import { CommandStoppedView } from './command-stopped-view'

export interface RunningCommand {
  podCommandId: string
  ptyInstanceId: string
  name: string
}

export interface CommandConfig {
  id: string
  name: string
  command: string
  directory: string | null
  directoryMode: 'absolute' | 'relative'
  autoStart: boolean
  sortOrder: number
  args?: { name: string; required: boolean; default?: string }[] | null
  tags: string[]
}

interface TabContentProps {
  item: ViewItem
  onTitleChange?: (podTerminalId: string, title: string) => void
  onRestartAgent?: (podTerminalId: string) => void
  onChanged?: () => void
}

export const TabContent = memo(function TabContent({
  item,
  onTitleChange,
  onRestartAgent,
  onChanged,
}: TabContentProps) {
  const { isRunning, isTemplate, runningTerminals, terminalConfigs, runningCommands, commandConfigs } =
    useTerminalRender()
  // Template mode — show static placeholder with config info
  if (isTemplate) {
    if (item.contentType === 'terminal' || item.contentType === 'agent') {
      const { podTerminalId } = item.config as TerminalItemConfig
      const config = terminalConfigs.find((t) => t.id === podTerminalId)
      const isAgent = item.contentType === 'agent'
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-4 bg-zinc-950/30">
          <RiTerminalLine className="h-8 w-8 text-zinc-700 mb-3" />
          <p className="text-sm text-zinc-400 mb-1">{item.label}</p>
          {config?.command && (
            <p className="text-xs text-zinc-600 font-mono mb-2">
              {config.command} {(config.args ?? []).join(' ')}
            </p>
          )}
          <p className="text-[10px] text-zinc-600 mt-1">{isAgent ? 'Agent' : 'Terminal'} — template preview</p>
        </div>
      )
    }
    if (item.contentType === 'command') {
      const { podCommandId } = item.config as CommandItemConfig
      const cmdConfig = commandConfigs.find((c) => c.id === podCommandId)
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-4 bg-zinc-950/30">
          <RiTerminalLine className="h-8 w-8 text-zinc-700 mb-3" />
          <p className="text-sm text-zinc-400 mb-1">{cmdConfig?.name ?? item.label}</p>
          {cmdConfig?.command && <p className="text-xs text-zinc-600 font-mono mb-2">{cmdConfig.command}</p>}
          <p className="text-[10px] text-zinc-600 mt-1">Command — template preview</p>
        </div>
      )
    }
    if (item.contentType === 'browser') {
      const { url } = item.config as BrowserItemConfig
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-4 bg-zinc-950/30">
          <p className="text-sm text-zinc-400 mb-1">{item.label}</p>
          <p className="text-xs text-zinc-600 font-mono mb-2">{url}</p>
          <p className="text-[10px] text-zinc-600 mt-1">Browser — template preview</p>
        </div>
      )
    }
    if (item.contentType === 'markdown') {
      const { filePath } = item.config as MarkdownItemConfig
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-4 bg-zinc-950/30">
          <RiFileTextLine className="h-8 w-8 text-zinc-700 mb-3" />
          <p className="text-sm text-zinc-400 mb-1">{item.label}</p>
          <p className="text-xs text-zinc-600 font-mono mb-2">{filePath}</p>
          <p className="text-[10px] text-zinc-600 mt-1">Markdown — template preview</p>
        </div>
      )
    }
  }

  if (item.contentType === 'terminal') {
    const { podTerminalId } = item.config as TerminalItemConfig
    const running = runningTerminals.find((t) => t.podTerminalId === podTerminalId)

    if (isRunning && running) {
      return (
        <TerminalView
          terminalId={running.ptyInstanceId}
          className="h-full"
          onTitleChange={onTitleChange ? (title) => onTitleChange(podTerminalId, title) : undefined}
        />
      )
    }

    // Stopped state — show terminal config
    const config = terminalConfigs.find((t) => t.id === podTerminalId)
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4">
        <RiTerminalLine className="h-8 w-8 text-zinc-700 mb-3" />
        <p className="text-sm text-zinc-400 mb-1">{item.label}</p>
        {config?.command && (
          <p className="text-xs text-zinc-600 font-mono mb-2">
            {config.command} {(config.args ?? []).join(' ')}
          </p>
        )}
        <p className="text-xs text-zinc-600">{isRunning ? 'Terminal is starting...' : 'Connecting...'}</p>
      </div>
    )
  }

  if (item.contentType === 'agent') {
    const { podTerminalId } = item.config as AgentItemConfig
    const running = runningTerminals.find((t) => t.podTerminalId === podTerminalId)

    if (isRunning && running) {
      return (
        <TerminalView
          terminalId={running.ptyInstanceId}
          className="h-full"
          onTitleChange={onTitleChange ? (title) => onTitleChange(podTerminalId, title) : undefined}
        />
      )
    }

    return <AgentStoppedView item={item} onRestart={onRestartAgent ? () => onRestartAgent(podTerminalId) : undefined} />
  }

  if (item.contentType === 'agent-session') {
    const { sessionId, pending, providerId } = item.config as AgentSessionItemConfig
    if (pending || !sessionId) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-4 bg-zinc-950/30">
          <RiTerminalLine className="h-8 w-8 text-zinc-700 mb-3 animate-pulse" />
          <p className="text-sm text-zinc-400 mb-1">{item.label}</p>
          <p className="text-xs text-zinc-600">
            Starting {providerId ? providerId.replaceAll('-', ' ') : 'agent'} session...
          </p>
        </div>
      )
    }
    return <AgentSessionContainer sessionId={SessionIdSchema.parse(sessionId)} podId={item.podId} className="h-full" />
  }

  if (item.contentType === 'command') {
    const { podCommandId } = item.config as CommandItemConfig
    const running = runningCommands.find((c) => c.podCommandId === podCommandId)

    if (running) {
      return <TerminalView terminalId={running.ptyInstanceId} className="h-full" />
    }

    const cmdConfig = commandConfigs.find((c) => c.id === podCommandId)
    return (
      <CommandStoppedView
        podCommandId={podCommandId}
        name={cmdConfig?.name ?? item.label}
        command={cmdConfig?.command}
        onChanged={onChanged}
      />
    )
  }

  if (item.contentType === 'browser') {
    const { url } = item.config as BrowserItemConfig
    return (
      <BrowserViewContent
        itemId={item.id}
        url={url}
        onTitleChange={onTitleChange ? (title) => onTitleChange(item.id, title) : undefined}
      />
    )
  }

  if (item.contentType === 'markdown') {
    const { filePath } = item.config as MarkdownItemConfig
    return <MarkdownEditorContent itemId={item.id} filePath={filePath} />
  }

  return (
    <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
      Unsupported content type: {item.contentType}
    </div>
  )
})
