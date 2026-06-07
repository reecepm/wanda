import { lazy, Suspense } from 'react'
import { useActiveView } from '@/features/view/store/view-store'
import { TerminalRenderProvider } from '@/features/view/terminal-render-context'
import type { RunningTerminal, TerminalConfig } from '@/types/terminal'
import { CarouselView } from './carousel-view'
import { ColumnsView } from './columns-view'
import { SplitPaneView } from './split-pane-view'
import type { CommandConfig, RunningCommand } from './tab-content'
import { TabsView } from './tabs-view'

const CanvasView = lazy(() => import('./canvas-view').then((m) => ({ default: m.CanvasView })))
const GridView = lazy(() => import('./grid-view').then((m) => ({ default: m.GridView })))

export interface ActiveViewRendererProps {
  podId: string
  podStatus: string
  isTemplate?: boolean
  runningTerminals: RunningTerminal[]
  terminalConfigs: TerminalConfig[]
  commandConfigs: CommandConfig[]
  runningCommands: RunningCommand[]
  onTerminalsChanged: () => void
  onNewCommand?: () => void
  onTerminalRemoved: (podTerminalId: string) => void
}

export function ActiveViewRenderer({
  onNewCommand,
  podId,
  podStatus,
  isTemplate,
  runningTerminals,
  terminalConfigs,
  commandConfigs,
  runningCommands,
  onTerminalsChanged,
  onTerminalRemoved,
}: ActiveViewRendererProps) {
  const activeView = useActiveView()

  function renderActive() {
    if (activeView?.viewType === 'tabs') {
      return <TabsView onNewCommand={onNewCommand} />
    }

    if (activeView?.viewType === 'canvas') {
      return (
        <Suspense fallback={<div className="flex-1" />}>
          <CanvasView key={podId} onNewCommand={onNewCommand} />
        </Suspense>
      )
    }

    if (activeView?.viewType === 'carousel') {
      return <CarouselView />
    }

    if (activeView?.viewType === 'columns') {
      return <ColumnsView />
    }

    if (activeView?.viewType === 'grid') {
      return (
        <Suspense fallback={<div className="flex-1" />}>
          <GridView />
        </Suspense>
      )
    }

    return <SplitPaneView />
  }

  return (
    <TerminalRenderProvider
      podId={podId}
      podStatus={podStatus}
      isTemplate={isTemplate}
      runningTerminals={runningTerminals}
      terminalConfigs={terminalConfigs}
      commandConfigs={commandConfigs}
      runningCommands={runningCommands}
      onTerminalsChanged={onTerminalsChanged}
      onTerminalRemoved={onTerminalRemoved}
    >
      <div
        className="contents"
        data-wanda-active-view=""
        data-wanda-view-type={activeView?.viewType ?? 'split-pane'}
        data-wanda-view-id={activeView?.id ?? ''}
      >
        {renderActive()}
      </div>
    </TerminalRenderProvider>
  )
}
