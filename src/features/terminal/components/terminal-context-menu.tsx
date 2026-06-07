import type { ReactNode } from 'react'
import { useState } from 'react'
import { RiClipboardLine, RiEraserLine, RiFileCopyLine } from '@/lib/icons'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import { terminalRegistry } from '../terminal-registry'
import { getTransportFor } from '../terminal-transport'

interface TerminalContextMenuProps {
  terminalId: string
  children: ReactNode
}

export function TerminalContextMenu({ terminalId, children }: TerminalContextMenuProps) {
  // Selection state is sampled at open-time so the Copy item can be
  // disabled when there's nothing to copy. Re-sampled on every open via
  // onOpenChange — xterm's selection lives outside React state.
  const [hasSelection, setHasSelection] = useState(false)

  function handleOpenChange(open: boolean) {
    if (!open) return
    const managed = terminalRegistry.instances.get(terminalId)
    setHasSelection(Boolean(managed?.terminal.hasSelection()))
  }

  function handleCopy() {
    const managed = terminalRegistry.instances.get(terminalId)
    const selection = managed?.terminal.getSelection() ?? ''
    if (!selection) return
    void navigator.clipboard.writeText(selection)
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText()
      if (text) getTransportFor(terminalId).write(terminalId, text)
    } catch (err) {
      console.error('[terminal] paste from clipboard failed', err)
    }
  }

  function handleClear() {
    void terminalRegistry.clear(terminalId)
  }

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleCopy} disabled={!hasSelection}>
          <RiFileCopyLine />
          Copy
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={handlePaste}>
          <RiClipboardLine />
          Paste
          <ContextMenuShortcut>⌘V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleClear}>
          <RiEraserLine />
          Clear
          <ContextMenuShortcut>⌘K</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
