// Hover preview bar — ported verbatim from
// monorepo/typescript/packages/ui/src/molecules/HoverPreviewBar.
// Adapted only to anchor the preview to the RIGHT of each trigger
// (instead of below it) so it works for vertical sidebars. Animation
// timings, fade behaviour, suppress-on-click, and ref tracking are
// otherwise identical to the original.

'use client'

import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/shared/utils'

export interface HoverPreviewBarItem {
  id: string
}

export interface HoverPreviewBarTriggerArgs {
  onClick: () => void
  isActive: boolean
}

export interface HoverPreviewBarProps<T extends HoverPreviewBarItem> {
  items: T[]
  renderTrigger: (item: T, args: HoverPreviewBarTriggerArgs) => ReactNode
  renderPreview: (item: T) => ReactNode
  onItemClick?: (item: T) => void
  /** Delay before opening the first preview (ms). Default 400. */
  openDelay?: number
  /** Delay before closing once the cursor has fully left the bar (ms). Default 120. */
  closeDelay?: number
  className?: string
  triggerWrapperClassName?: string
  previewClassName?: string
}

export function HoverPreviewBar<T extends HoverPreviewBarItem>({
  items,
  renderTrigger,
  renderPreview,
  onItemClick,
  openDelay = 400,
  closeDelay = 120,
  className,
  triggerWrapperClassName,
  previewClassName,
}: HoverPreviewBarProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  const activeElementRef = useRef<HTMLElement | null>(null)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressedRef = useRef<Set<string>>(new Set())
  const isOpenRef = useRef(false)

  const clearOpenTimer = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
  }
  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const handleEnter = (id: string, el: HTMLElement) => {
    clearCloseTimer()
    if (suppressedRef.current.has(id)) return
    activeElementRef.current = el
    if (isOpenRef.current) {
      clearOpenTimer()
      setActiveId(id)
      return
    }
    clearOpenTimer()
    openTimerRef.current = setTimeout(() => {
      setActiveId(id)
      isOpenRef.current = true
      openTimerRef.current = null
    }, openDelay)
  }

  const handleLeave = (id: string) => {
    clearOpenTimer()
    suppressedRef.current.delete(id)
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      setActiveId(null)
      isOpenRef.current = false
      activeElementRef.current = null
      closeTimerRef.current = null
    }, closeDelay)
  }

  const handleClick = (item: T) => {
    clearOpenTimer()
    clearCloseTimer()
    setActiveId(null)
    isOpenRef.current = false
    activeElementRef.current = null
    suppressedRef.current.add(item.id)
    onItemClick?.(item)
  }

  // Right-anchor: card sits to the right of the trigger, top-aligned.
  // Uses viewport coords (with `position: fixed` + a portal) so the card
  // escapes any `overflow: hidden` ancestors — sidebars, accordions, and
  // scroll containers all clip absolutely-positioned descendants, which
  // would otherwise hide this card entirely.
  useLayoutEffect(() => {
    if (!activeId) return
    const el = activeElementRef.current
    if (!el) return
    const elRect = el.getBoundingClientRect()
    setPosition({ left: elRect.right, top: elRect.top })
  }, [activeId])

  useEffect(() => {
    if (!activeId) return
    const reposition = () => {
      const el = activeElementRef.current
      if (!el) return
      const elRect = el.getBoundingClientRect()
      setPosition({ left: elRect.right, top: elRect.top })
    }
    window.addEventListener('resize', reposition)
    // Capture phase so we catch ancestor scroll containers (e.g. the
    // sidebar's scrollable content area) without registering on each one.
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [activeId])

  const activeItem = activeId ? (items.find((i) => i.id === activeId) ?? null) : null

  const portalTarget = typeof document !== 'undefined' ? document.body : null

  return (
    <div className={cn('relative', className)}>
      {items.map((item) => (
        <HoverPreviewTrigger
          key={item.id}
          item={item}
          isActive={activeId === item.id}
          triggerWrapperClassName={triggerWrapperClassName}
          renderTrigger={renderTrigger}
          onEnter={handleEnter}
          onLeave={handleLeave}
          onClick={handleClick}
        />
      ))}
      {portalTarget &&
        createPortal(
          <AnimatePresence onExitComplete={() => setPosition(null)}>
            {activeItem && position && (
              // Outer layer — positioning only (top/left springs + entry/exit).
              // No visible chrome here, so the layout animation on the inner
              // chrome layer doesn't fight the position springs.
              <motion.div
                key="hover-preview-panel"
                initial={{ opacity: 0, x: -4, left: position.left, top: position.top }}
                animate={{ opacity: 1, x: 0, left: position.left, top: position.top }}
                exit={{ opacity: 0, x: -4 }}
                transition={{
                  left: { type: 'spring', duration: 0.32, bounce: 0 },
                  top: { type: 'spring', duration: 0.32, bounce: 0 },
                  opacity: { duration: 0.14 },
                  x: { duration: 0.14 },
                }}
                className="pointer-events-auto fixed z-50 ml-2"
              >
                {/* Inner layer — card chrome. Height is animated explicitly
                    from a ResizeObserver-measured value of the inner content
                    (rather than via framer's `layout` prop, which uses scale
                    transforms and visibly stretches the content during the
                    transition). With `mode="popLayout"` on the inner
                    AnimatePresence the exiting content is taken out of flow
                    as exit starts, so `innerHeight` reflects the NEW
                    content's natural height immediately and the chrome
                    springs height to it. New content is rendered at its
                    full natural size the entire time — no squeeze. */}
                <ChromeWithMeasuredHeight previewClassName={previewClassName} activeId={activeItem.id}>
                  {renderPreview(activeItem)}
                </ChromeWithMeasuredHeight>
              </motion.div>
            )}
          </AnimatePresence>,
          portalTarget,
        )}
    </div>
  )
}

function HoverPreviewTrigger<T extends HoverPreviewBarItem>({
  item,
  isActive,
  triggerWrapperClassName,
  renderTrigger,
  onEnter,
  onLeave,
  onClick,
}: {
  item: T
  isActive: boolean
  triggerWrapperClassName: string | undefined
  renderTrigger: (item: T, args: HoverPreviewBarTriggerArgs) => ReactNode
  onEnter: (id: string, el: HTMLElement) => void
  onLeave: (id: string) => void
  onClick: (item: T) => void
}) {
  return (
    <div
      role="presentation"
      className={cn('relative', triggerWrapperClassName)}
      onMouseEnter={(event) => onEnter(item.id, event.currentTarget)}
      onMouseLeave={() => onLeave(item.id)}
    >
      {renderTrigger(item, {
        onClick: () => onClick(item),
        isActive,
      })}
    </div>
  )
}

function ChromeWithMeasuredHeight({
  activeId,
  previewClassName,
  children,
}: {
  activeId: string
  previewClassName: string | undefined
  children: ReactNode
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)

  // Track the inner content's natural height via ResizeObserver. With
  // `mode="popLayout"` on the inner AnimatePresence the exiting child
  // is absolutely positioned, so the observed height is always the
  // current entering child's intrinsic size — exactly what we want the
  // chrome to spring to.
  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    setHeight(el.offsetHeight)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setHeight(entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <motion.div
      animate={{ height: height ?? 'auto' }}
      transition={{ height: { type: 'spring', duration: 0.32, bounce: 0 } }}
      className={cn('overflow-hidden', previewClassName)}
    >
      <div ref={innerRef}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={activeId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
