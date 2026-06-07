import { createContext, type ReactNode, useContext, useMemo } from 'react'
import type { CommandConfig, RunningCommand } from '@/features/view/components/tab-content'
import type { RunningTerminal, TerminalConfig } from '@/types/terminal'

/**
 * Shared terminal-rendering inputs threaded into every view renderer
 * (split-pane, columns, carousel, grid, tabs, canvas) and the leaf
 * `TabContent`. Provided once by `ActiveViewRenderer` so the view family
 * reads these values from context instead of drilling them through each
 * layout layer.
 */
export interface TerminalRenderContextValue {
  podId: string
  podStatus: string
  isRunning: boolean
  isTemplate?: boolean
  runningTerminals: RunningTerminal[]
  terminalConfigs: TerminalConfig[]
  commandConfigs: CommandConfig[]
  runningCommands: RunningCommand[]
  onTerminalsChanged: () => void
  onTerminalRemoved: (podTerminalId: string) => void
}

const TerminalRenderContext = createContext<TerminalRenderContextValue | null>(null)

export interface TerminalRenderProviderProps {
  podId: string
  podStatus: string
  isTemplate?: boolean
  runningTerminals: RunningTerminal[]
  terminalConfigs: TerminalConfig[]
  commandConfigs: CommandConfig[]
  runningCommands: RunningCommand[]
  onTerminalsChanged: () => void
  onTerminalRemoved: (podTerminalId: string) => void
  children: ReactNode
}

export function TerminalRenderProvider({
  podId,
  podStatus,
  isTemplate,
  runningTerminals,
  terminalConfigs,
  commandConfigs,
  runningCommands,
  onTerminalsChanged,
  onTerminalRemoved,
  children,
}: TerminalRenderProviderProps) {
  const value = useMemo<TerminalRenderContextValue>(
    () => ({
      podId,
      podStatus,
      isRunning: podStatus === 'running',
      isTemplate,
      runningTerminals,
      terminalConfigs,
      commandConfigs,
      runningCommands,
      onTerminalsChanged,
      onTerminalRemoved,
    }),
    [
      podId,
      podStatus,
      isTemplate,
      runningTerminals,
      terminalConfigs,
      commandConfigs,
      runningCommands,
      onTerminalsChanged,
      onTerminalRemoved,
    ],
  )

  return <TerminalRenderContext.Provider value={value}>{children}</TerminalRenderContext.Provider>
}

export function useTerminalRender(): TerminalRenderContextValue {
  const ctx = useContext(TerminalRenderContext)
  if (!ctx) {
    throw new Error('useTerminalRender must be used within a TerminalRenderProvider')
  }
  return ctx
}
