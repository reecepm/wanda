import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

/**
 * IntersectionObserver-based virtualization hook for carousel and columns views.
 * Only items near the viewport are marked as "visible" so xterm instances are
 * mounted lazily.
 *
 * Usage:
 *   const { visibleIds, registerItem } = useVirtualizedItems({ containerRef })
 *   <div ref={(el) => registerItem(itemId, el)}>
 *     {visibleIds.has(itemId) ? <TabContent ... /> : <placeholder />}
 *   </div>
 */
export function useVirtualizedItems(config: {
  containerRef: RefObject<HTMLElement | null>
  buffer?: number // viewport multiplier for rootMargin, default 1
}): {
  visibleIds: Set<string>
  registerItem: (itemId: string, el: HTMLElement | null) => void
} {
  const { containerRef, buffer = 1 } = config
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const elementsRef = useRef<Map<string, HTMLElement>>(new Map())
  const pendingRef = useRef<Set<string>>(new Set())
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const root = containerRef.current
    if (!root) return

    const margin = `${buffer * 100}%`
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const itemId = (entry.target as HTMLElement).dataset.virtualItemId
          if (!itemId) continue
          if (entry.isIntersecting) {
            pendingRef.current.add(itemId)
          } else {
            pendingRef.current.delete(itemId)
          }
        }

        // Batch state updates via rAF
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          setVisibleIds(new Set(pendingRef.current))
        })
      },
      {
        root,
        rootMargin: `${margin} ${margin} ${margin} ${margin}`,
        threshold: 0,
      },
    )

    observerRef.current = observer

    for (const [, el] of elementsRef.current) {
      observer.observe(el)
    }

    return () => {
      cancelAnimationFrame(rafRef.current)
      observer.disconnect()
      observerRef.current = null
    }
  }, [containerRef, buffer])

  const registerItem = useCallback((itemId: string, el: HTMLElement | null) => {
    const prev = elementsRef.current.get(itemId)
    if (prev && observerRef.current) {
      observerRef.current.unobserve(prev)
    }

    if (el) {
      el.dataset.virtualItemId = itemId
      elementsRef.current.set(itemId, el)
      if (observerRef.current) {
        observerRef.current.observe(el)
      }
    } else {
      elementsRef.current.delete(itemId)
      pendingRef.current.delete(itemId)
    }
  }, [])

  return { visibleIds, registerItem }
}
