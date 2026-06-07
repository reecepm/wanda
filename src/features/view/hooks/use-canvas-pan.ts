import { useReactFlow } from '@xyflow/react'
import { useEffect, useRef } from 'react'

/** Inactivity threshold (ms) to detect end of a trackpad gesture. macOS
 *  momentum events fire every ~16ms, so 150ms of silence means the gesture
 *  ended and the next wheel event starts a fresh one. */
const GESTURE_TIMEOUT = 150

/**
 * Replaces ReactFlow's built-in `panOnScroll` with a gesture-aware handler
 * that prevents xterm's native scroll from hijacking canvas panning.
 *
 * How it works:
 * 1. The first wheel event in a gesture locks the mode — `pan` if it started
 *    on the canvas background, `scroll` if it started on a focused node's
 *    scrollable content (`.xterm` or `.canvas-scrollable`).
 * 2. A CSS class (`canvas-panning`) sets `pointer-events: none` on scrollable
 *    content so subsequent pan events pass through to the canvas.
 * 3. The listener runs in the **capture phase** with `stopPropagation()` so
 *    the compositor can't start native scroll before `preventDefault()` fires.
 * 4. Pinch-to-zoom (ctrlKey) always passes through to ReactFlow's zoomOnPinch.
 */
export function useCanvasPan(containerRef: React.RefObject<HTMLDivElement | null>) {
  const gestureMode = useRef<'pan' | 'scroll' | null>(null)
  const gestureTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const { getViewport, setViewport } = useReactFlow()

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      // Pinch-to-zoom — handle manually because terminal nodes block
      // wheel propagation (stopWheelBubble), preventing ReactFlow's
      // built-in zoomOnPinch from ever seeing the event.
      if (e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        const { x, y, zoom } = getViewport()
        // deltaY is positive for "zoom out" on trackpad pinch
        const zoomFactor = 1 - e.deltaY * 0.01
        const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.2), 2)
        // Zoom toward the pointer position
        const rect = el.getBoundingClientRect()
        const pointerX = e.clientX - rect.left
        const pointerY = e.clientY - rect.top
        const scaleChange = newZoom / zoom
        setViewport(
          {
            x: pointerX - (pointerX - x) * scaleChange,
            y: pointerY - (pointerY - y) * scaleChange,
            zoom: newZoom,
          },
          { duration: 0 },
        )
        return
      }

      // Reset gesture after inactivity
      clearTimeout(gestureTimer.current)
      gestureTimer.current = setTimeout(() => {
        gestureMode.current = null
        el.classList.remove('canvas-panning')
      }, GESTURE_TIMEOUT)

      // Lock mode from the first event of each gesture. Only a *focused*
      // terminal enters scroll mode — unfocused terminals let panning through.
      // Focused terminals are marked with data-focused on their container.
      if (gestureMode.current === null) {
        const scrollableEl = (e.target as HTMLElement).closest?.('.xterm, .canvas-scrollable')
        const inFocusedNode = scrollableEl?.closest?.('[data-focused]')
        gestureMode.current = inFocusedNode ? 'scroll' : 'pan'
        if (gestureMode.current === 'pan') {
          el.classList.add('canvas-panning')
        }
      }

      if (gestureMode.current === 'pan') {
        e.preventDefault()
        e.stopPropagation()
        const { x, y, zoom } = getViewport()
        setViewport({ x: x - e.deltaX, y: y - e.deltaY, zoom }, { duration: 0 })
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true })
      el.classList.remove('canvas-panning')
      clearTimeout(gestureTimer.current)
    }
  }, [containerRef, getViewport, setViewport])
}
