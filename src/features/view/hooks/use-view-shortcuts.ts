import { useEffect } from 'react'
import { type CloseInfo, setCloseCallback, setSplitCallback } from '@/features/shortcuts'

/**
 * Registers split and close callbacks for keyboard shortcuts.
 *
 * @param onSplit - Called when a split shortcut fires (receives direction for split-pane, ignored by other views)
 * @param onClose - Called when a close shortcut fires (receives item info for server-side cleanup)
 */
export function useViewShortcuts({
  onSplit,
  onClose,
}: {
  onSplit: (direction: 'horizontal' | 'vertical') => void
  onClose: (info: CloseInfo) => void
}) {
  useEffect(() => {
    setSplitCallback((direction) => onSplit(direction))
    return () => setSplitCallback(null)
  }, [onSplit])

  useEffect(() => {
    setCloseCallback((info) => onClose(info))
    return () => setCloseCallback(null)
  }, [onClose])
}
