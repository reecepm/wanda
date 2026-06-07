import { useEffect, useRef } from 'react'

/** Inactivity threshold (ms) to detect end of a trackpad gesture. macOS
 *  momentum events fire every ~16ms, so 150ms of silence means the gesture
 *  ended and the next wheel event starts a fresh one. */
const GESTURE_TIMEOUT = 150

/**
 * Captures wheel events on the columns scroll container so that unfocused
 * terminals don't swallow scroll gestures.
 *
 * When a scroll gesture starts over an unfocused terminal (or the background),
 * the hook locks into "container" mode and redirects all wheel deltas to the
 * outer scroll container. Focused terminals keep normal scroll behavior.
 */
export function useColumnsScroll(containerRef: React.RefObject<HTMLDivElement | null>) {
  const gestureMode = useRef<'container' | 'scroll' | null>(null)
  const gestureTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      // Pinch-to-zoom — let the browser handle it
      if (e.ctrlKey) return

      // Reset gesture after inactivity
      clearTimeout(gestureTimer.current)
      gestureTimer.current = setTimeout(() => {
        gestureMode.current = null
      }, GESTURE_TIMEOUT)

      // Lock mode from the first event of each gesture
      if (gestureMode.current === null) {
        const xtermEl = (e.target as HTMLElement).closest?.('.xterm')
        const inFocusedTerminal = xtermEl?.closest?.('[data-focused]')
        gestureMode.current = inFocusedTerminal ? 'scroll' : 'container'
      }

      if (gestureMode.current === 'container') {
        e.preventDefault()
        e.stopPropagation()
        el.scrollLeft += e.deltaX
        el.scrollTop += e.deltaY
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true })
      clearTimeout(gestureTimer.current)
    }
  }, [containerRef])
}
