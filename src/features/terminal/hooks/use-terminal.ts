import type { Terminal } from '@xterm/xterm'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import type { AcquireOptions } from '../terminal-registry'
import { terminalRegistry } from '../terminal-registry'

export function useTerminal(
  ptyInstanceId: string,
  options?: AcquireOptions,
): {
  slotRef: React.RefObject<HTMLDivElement | null>
  terminal: Terminal | null
} {
  const slotRef = useRef<HTMLDivElement | null>(null)
  const [terminal, setTerminal] = useState<Terminal | null>(null)

  // Keep options in a ref so the effect doesn't re-run on every render
  const optionsRef = useRef(options)
  useLayoutEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    if (!slotRef.current) return

    const managed = terminalRegistry.acquire(ptyInstanceId, optionsRef.current)
    terminalRegistry.mount(ptyInstanceId, slotRef.current)
    setTerminal(managed.terminal)

    return () => {
      terminalRegistry.park(ptyInstanceId)
    }
  }, [ptyInstanceId])

  // Focus xterm when this terminal becomes the selected pane
  const isSelected = useUIStore((s) => s.selectedId === ptyInstanceId)
  useEffect(() => {
    if (isSelected) {
      terminalRegistry.focus(ptyInstanceId)
    }
  }, [isSelected, ptyInstanceId])

  return { slotRef, terminal }
}
