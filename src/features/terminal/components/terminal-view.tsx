import { useTerminal } from '../hooks/use-terminal'
import { TerminalContextMenu } from './terminal-context-menu'
import '@xterm/xterm/css/xterm.css'

interface TerminalViewProps {
  terminalId: string
  className?: string
  fontSize?: number
  onReady?: () => void
  onTitleChange?: (title: string) => void
}

export function TerminalView({ terminalId, className, fontSize = 13, onTitleChange }: TerminalViewProps) {
  const { slotRef } = useTerminal(terminalId, { fontSize, onTitleChange })
  return (
    <TerminalContextMenu terminalId={terminalId}>
      <div ref={slotRef} className={`w-full h-full min-h-0 overflow-hidden ${className ?? ''}`} />
    </TerminalContextMenu>
  )
}
