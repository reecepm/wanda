import { AnimatePresence, motion, useAnimationControls } from 'motion/react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { RiFolderOpenLine, RiGlobalLine, RiRobotLine, RiTerminalBoxLine } from '@/lib/icons'
import { cn } from '@/shared/utils'

/**
 * Feature tour chapter: pods + items.
 *
 * Narrative (plays in sequence, then loops):
 *
 *   1. Sidebar slides in showing the "wanda" workspace, empty.
 *   2. `my-pod` is added to the sidebar.
 *   3. A `claude` agent spawns under `my-pod` in the sidebar AND as a bubbly
 *      card on the canvas.
 *   4. Two more pods (`frontend`, `api`) appear in the sidebar so it's
 *      obvious the workspace contains multiple pods.
 *   5. Sidebar slides out, canvas expands to full stage width.
 *   6. Three more items (terminal, browser, terminal-2) bubble-spawn onto
 *      the canvas at spread-out positions.
 *   7. Cursor appears and clicks the `Carousel` option in the view list
 *      (which lives in the top-right of the app toolbar, matching real
 *      Wanda). Items reflow via `layoutId` into a horizontal carousel.
 *   8. Cursor clicks the `Tabs` option. The carousel view cross-fades to
 *      the tabs view (no shared layoutId between carousel cards and tab
 *      pills, because sharing caused the cards to warp as their shapes
 *      changed).
 *   9. Hold, fade cursor, loop.
 */

type Phase =
  | 'idle'
  | 'sidebar-in'
  | 'pod-main'
  | 'agent-spawned'
  | 'pod-frontend'
  | 'pod-api'
  | 'sidebar-out'
  | 'spawn-terminal'
  | 'spawn-browser'
  | 'spawn-terminal-2'
  | 'all-spawned'
  | 'hovering-carousel'
  | 'carousel-view'
  | 'hovering-tabs'
  | 'tabs-view'
  | 'done'

type ViewType = 'canvas' | 'carousel' | 'tabs'

type ItemType = 'terminal' | 'agent' | 'browser'

interface PodItem {
  id: string
  type: ItemType
  label: string
  /** Canvas-view X position as a percentage of the canvas container (0–100), center. */
  canvasX: number
  /** Canvas-view Y position as a percentage of the canvas container (0–100), center. */
  canvasY: number
  preview: string[]
}

/**
 * Item catalog. Order matters: the agent is first because it spawns first
 * (while the sidebar is still visible); the others bubble in afterwards.
 *
 * Canvas positions are spread so items never overlap or clip the canvas
 * edges. At card size 22%×30% centered on (x, y), each item's bounding box
 * stays comfortably inside [0, 100].
 */
const ITEMS: PodItem[] = [
  {
    id: 'agent-claude',
    type: 'agent',
    label: 'claude',
    canvasX: 52,
    canvasY: 48,
    preview: ['◦ Refactoring auth', '  middleware...', '  3 files pending'],
  },
  {
    id: 'term-dev',
    type: 'terminal',
    label: 'bun run dev',
    canvasX: 22,
    canvasY: 35,
    preview: ['$ bun run dev', '✓ ready in 412ms'],
  },
  {
    id: 'browser-local',
    type: 'browser',
    label: 'localhost:5173',
    canvasX: 80,
    canvasY: 35,
    preview: ['http://localhost:5173', 'Wanda dev'],
  },
  {
    id: 'term-tsc',
    type: 'terminal',
    label: 'tsc --watch',
    canvasX: 30,
    canvasY: 80,
    preview: ['$ tsc --watch', '✓ No errors.'],
  },
]

/**
 * Pods shown in the sidebar under the "wanda" workspace. `hasAgent` drives
 * whether the "claude" agent child row appears under that pod.
 */
interface SidebarPod {
  id: string
  name: string
  hasAgent?: boolean
}

const SIDEBAR_PODS: SidebarPod[] = [
  { id: 'my-pod', name: 'my-pod', hasAgent: true },
  { id: 'frontend', name: 'frontend' },
  { id: 'api', name: 'api' },
]

const VIEW_OPTIONS: { key: ViewType; label: string }[] = [
  { key: 'canvas', label: 'Canvas' },
  { key: 'carousel', label: 'Carousel' },
  { key: 'tabs', label: 'Tabs' },
]

/** Smooth, non-bouncy easing for layoutId transitions between views. */
const LAYOUT_TRANSITION = { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const }
const SPAWN_TRANSITION = { type: 'spring' as const, damping: 14, stiffness: 180 }

export function PodsStory() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [replayToken, setReplayToken] = useState(0)
  const cursor = useAnimationControls()

  const stageRef = useRef<HTMLDivElement>(null)
  const carouselBtnRef = useRef<HTMLButtonElement>(null)
  const tabsBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false

    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
    const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

    function centerOf(ref: RefObject<HTMLElement | null>): { x: number; y: number } | null {
      if (!stageRef.current || !ref.current) return null
      const stage = stageRef.current.getBoundingClientRect()
      const target = ref.current.getBoundingClientRect()
      return {
        x: target.left + target.width / 2 - stage.left,
        y: target.top + target.height / 2 - stage.top,
      }
    }

    async function moveCursorTo(ref: RefObject<HTMLElement | null>, duration = 0.75) {
      await nextFrame()
      await nextFrame()
      const pos = centerOf(ref)
      if (!pos) return
      await cursor.start({ left: pos.x, top: pos.y }, { duration, ease: [0.22, 1, 0.36, 1] })
    }

    async function clickPulse() {
      await cursor.start({ scale: [1, 0.85, 1] }, { duration: 0.3 })
    }

    async function run() {
      // Reset
      setPhase('idle')
      await cursor.start({ left: 0, top: 0, opacity: 0, scale: 1 }, { duration: 0 })
      if (cancelled) return
      await wait(200)

      // --- Sidebar / pod creation phase (kept fast — it's setup context,
      //     not the main story). Total ~2.5s to reach `sidebar-out`.
      setPhase('sidebar-in')
      await wait(500)
      if (cancelled) return

      setPhase('pod-main')
      await wait(350)
      if (cancelled) return

      setPhase('agent-spawned')
      await wait(650)
      if (cancelled) return

      setPhase('pod-frontend')
      await wait(300)
      if (cancelled) return

      setPhase('pod-api')
      await wait(500)
      if (cancelled) return

      setPhase('sidebar-out')
      await wait(500)
      if (cancelled) return

      // --- Canvas spawn phase
      setPhase('spawn-terminal')
      await wait(450)
      if (cancelled) return
      setPhase('spawn-browser')
      await wait(450)
      if (cancelled) return
      setPhase('spawn-terminal-2')
      await wait(450)
      if (cancelled) return

      setPhase('all-spawned')
      await wait(900)
      if (cancelled) return

      // --- View switching phase
      await moveCursorTo(carouselBtnRef, 0.9)
      if (cancelled) return
      await cursor.start({ opacity: 1 }, { duration: 0.25 })
      setPhase('hovering-carousel')
      await wait(250)
      await clickPulse()
      if (cancelled) return
      setPhase('carousel-view')
      await wait(1800)
      if (cancelled) return

      await moveCursorTo(tabsBtnRef, 0.75)
      if (cancelled) return
      setPhase('hovering-tabs')
      await wait(250)
      await clickPulse()
      if (cancelled) return
      setPhase('tabs-view')
      // Stay on tabs view a bit longer — it's the final "rest" state that
      // sells the view-switching story, worth letting the user dwell on it.
      await wait(3000)
      if (cancelled) return

      setPhase('done')
      await cursor.start({ opacity: 0 }, { duration: 0.3 })
      if (cancelled) return
      await wait(400)
      setReplayToken((t) => t + 1)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [cursor, replayToken])

  // --- Derived state ----------------------------------------------------

  const showSidebar =
    phase === 'sidebar-in' ||
    phase === 'pod-main' ||
    phase === 'agent-spawned' ||
    phase === 'pod-frontend' ||
    phase === 'pod-api' ||
    phase === 'sidebar-out'

  /** Which pods are visible in the sidebar right now. */
  const visiblePodIds = new Set<string>()
  if (phase === 'pod-main' || isAfter(phase, 'pod-main')) visiblePodIds.add('my-pod')
  if (phase === 'pod-frontend' || isAfter(phase, 'pod-frontend')) visiblePodIds.add('frontend')
  if (phase === 'pod-api' || isAfter(phase, 'pod-api')) visiblePodIds.add('api')

  const showAgentInSidebar = isAtLeast(phase, 'agent-spawned')

  /** Which items have been spawned onto the canvas. */
  const spawnedIds = new Set<string>()
  if (isAtLeast(phase, 'agent-spawned')) spawnedIds.add('agent-claude')
  if (isAtLeast(phase, 'spawn-terminal')) spawnedIds.add('term-dev')
  if (isAtLeast(phase, 'spawn-browser')) spawnedIds.add('browser-local')
  if (isAtLeast(phase, 'spawn-terminal-2')) spawnedIds.add('term-tsc')

  const visibleItems = ITEMS.filter((i) => spawnedIds.has(i.id))

  const viewType: ViewType =
    phase === 'carousel-view' || phase === 'hovering-tabs'
      ? 'carousel'
      : phase === 'tabs-view' || phase === 'done'
        ? 'tabs'
        : 'canvas'

  return (
    <div className="relative w-full">
      <div
        ref={stageRef}
        className="relative flex aspect-[16/9] w-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 shadow-2xl shadow-black/40"
      >
        {/*
          Top toolbar — traffic lights + workspace title on the left,
          view-type list on the right (mirrors the normal Wanda top bar).
        */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 px-3.5 py-2">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-zinc-700" />
            <span className="size-2 rounded-full bg-zinc-700" />
            <span className="size-2 rounded-full bg-zinc-700" />
            <span className="ml-2 text-xs text-zinc-500">Wanda</span>
          </div>

          <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-900/60 p-0.5">
            {VIEW_OPTIONS.map((v) => {
              const isActive = viewType === v.key
              const isHovering =
                (v.key === 'carousel' && phase === 'hovering-carousel') ||
                (v.key === 'tabs' && phase === 'hovering-tabs')
              return (
                <button
                  key={v.key}
                  type="button"
                  ref={v.key === 'carousel' ? carouselBtnRef : v.key === 'tabs' ? tabsBtnRef : undefined}
                  className={cn(
                    'rounded-sm px-2 py-0.5 text-[11px] transition-colors',
                    isActive
                      ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                      : isHovering
                        ? 'bg-amber-500/20 text-amber-100'
                        : 'text-zinc-500',
                  )}
                >
                  {v.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Body: sidebar + main content */}
        <div className="relative flex min-h-0 flex-1">
          <motion.aside
            initial={false}
            animate={{
              width: showSidebar ? '22%' : '0%',
              opacity: showSidebar ? 1 : 0,
            }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="shrink-0 overflow-hidden border-r border-zinc-800/80 bg-zinc-900/40"
          >
            <div className="min-w-[150px] p-3">
              <div className="flex items-center gap-1.5">
                <RiFolderOpenLine className="size-3.5 text-zinc-500" />
                <span className="text-xs font-medium text-zinc-300">wanda</span>
              </div>

              <div className="mt-2 flex flex-col gap-1">
                <AnimatePresence initial={false}>
                  {SIDEBAR_PODS.filter((p) => visiblePodIds.has(p.id)).map((pod) => (
                    <motion.div
                      key={pod.id}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.25 }}
                      className="pl-3"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-amber-500" />
                        <span className="text-[11px] text-zinc-300">{pod.name}</span>
                      </div>

                      {pod.hasAgent && (
                        <AnimatePresence>
                          {showAgentInSidebar && (
                            <motion.div
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.25 }}
                              className="mt-1 flex items-center gap-1.5 pl-3.5"
                            >
                              <RiRobotLine className="size-3 text-amber-400" />
                              <span className="text-[11px] text-zinc-400">claude</span>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </motion.aside>

          {/* Content area (canvas / carousel / tabs) */}
          <div className="relative min-w-0 flex-1">
            <ViewContent viewType={viewType} items={visibleItems} />
          </div>
        </div>

        {/* Cursor */}
        <motion.div
          animate={cursor}
          initial={{ opacity: 0, left: 0, top: 0, scale: 1 }}
          className="pointer-events-none absolute z-30"
        >
          <svg
            width="18"
            height="22"
            viewBox="0 0 14 18"
            fill="none"
            style={{ display: 'block', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}
          >
            <path
              d="M0 0 L13 11 L6 11 L3 17 Z"
              fill="#fafafa"
              stroke="#18181b"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
        </motion.div>
      </div>

      {/* Replay */}
      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={() => setReplayToken((t) => t + 1)}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Replay animation
        </button>
      </div>
    </div>
  )
}

// --- Phase helpers ---------------------------------------------------------

const PHASE_ORDER: Phase[] = [
  'idle',
  'sidebar-in',
  'pod-main',
  'agent-spawned',
  'pod-frontend',
  'pod-api',
  'sidebar-out',
  'spawn-terminal',
  'spawn-browser',
  'spawn-terminal-2',
  'all-spawned',
  'hovering-carousel',
  'carousel-view',
  'hovering-tabs',
  'tabs-view',
  'done',
]
function isAfter(phase: Phase, ref: Phase): boolean {
  return PHASE_ORDER.indexOf(phase) > PHASE_ORDER.indexOf(ref)
}
function isAtLeast(phase: Phase, ref: Phase): boolean {
  return PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf(ref)
}

// --- View renderers --------------------------------------------------------

/**
 * Renders items for the active view type.
 *
 * Canvas and Carousel SHARE `layoutId={pod-item-${id}}` on each item card,
 * so framer animates the card's bounding box between the two views in one
 * continuous motion.
 *
 * Tabs does NOT share layoutId with the carousel — the dramatic shape
 * change from a full card to a small pill was causing visible warping. The
 * tab row and focused content are rendered as fresh elements that
 * crossfade from the carousel. It's a cleaner look.
 */
function ViewContent({ viewType, items }: { viewType: ViewType; items: PodItem[] }) {
  if (viewType === 'canvas') {
    return (
      <div
        className="relative h-full w-full"
        style={{
          backgroundImage: 'radial-gradient(rgba(113,113,122,0.2) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      >
        {items.map((item) => (
          <motion.div
            key={item.id}
            layoutId={`pod-item-${item.id}`}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ layout: LAYOUT_TRANSITION, default: SPAWN_TRANSITION }}
            className="absolute"
            style={{
              left: `${item.canvasX}%`,
              top: `${item.canvasY}%`,
              width: '22%',
              height: '30%',
              marginLeft: '-11%',
              marginTop: '-15%',
            }}
          >
            <ItemCard item={item} />
          </motion.div>
        ))}
      </div>
    )
  }

  if (viewType === 'carousel') {
    return (
      <div className="relative flex h-full items-center gap-3 overflow-hidden px-6">
        {items.map((item) => (
          <motion.div
            key={item.id}
            layoutId={`pod-item-${item.id}`}
            transition={{ layout: LAYOUT_TRANSITION }}
            className="h-[78%] w-[22%] shrink-0"
          >
            <ItemCard item={item} />
          </motion.div>
        ))}
      </div>
    )
  }

  // Tabs view: tab row up top + focused content below. Both are fresh
  // elements (no layoutId) that fade in after the carousel view unmounts.
  const focused = items[0]
  return (
    <motion.div
      key="tabs-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, delay: 0.15 }}
      className="flex h-full flex-col gap-1.5 p-3"
    >
      <div className="flex gap-1">
        {items.map((item, i) => (
          <div
            key={item.id}
            className={cn(
              'flex items-center gap-1.5 rounded-t-sm border-x border-t px-2.5 py-1 text-[11px]',
              i === 0 ? 'border-zinc-700 bg-zinc-800 text-zinc-200' : 'border-zinc-800/70 bg-zinc-900/60 text-zinc-500',
            )}
          >
            <TypeIcon type={item.type} dim={i !== 0} />
            <span className="truncate">{item.label}</span>
          </div>
        ))}
      </div>
      {focused && (
        <div className="flex-1 overflow-hidden rounded-sm border border-zinc-800 bg-zinc-900/70 p-3">
          <ItemBody item={focused} />
        </div>
      )}
    </motion.div>
  )
}

function ItemCard({ item }: { item: PodItem }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-sm border border-zinc-700 bg-zinc-900/90 shadow-lg shadow-black/30">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800/80 bg-zinc-900/80 px-2 py-1">
        <TypeIcon type={item.type} />
        <span className="truncate text-[11px] text-zinc-300">{item.label}</span>
      </div>
      <div className="min-h-0 flex-1">
        <ItemBody item={item} />
      </div>
    </div>
  )
}

function ItemBody({ item }: { item: PodItem }) {
  const accent =
    item.type === 'terminal' ? 'text-emerald-400/90' : item.type === 'agent' ? 'text-amber-400/90' : 'text-blue-400/90'
  return (
    <div className="flex h-full flex-col gap-0.5 p-2 font-mono text-[11px] leading-relaxed">
      {item.preview.map((line, i) => (
        <div key={i} className={i === 0 ? 'text-zinc-400' : i === 1 ? accent : 'text-zinc-600'}>
          {line}
        </div>
      ))}
    </div>
  )
}

function TypeIcon({ type, dim }: { type: ItemType; dim?: boolean }) {
  const opacity = dim ? 'opacity-60' : ''
  if (type === 'terminal') return <RiTerminalBoxLine className={`size-3 text-emerald-400 ${opacity}`} />
  if (type === 'agent') return <RiRobotLine className={`size-3 text-amber-400 ${opacity}`} />
  return <RiGlobalLine className={`size-3 text-blue-400 ${opacity}`} />
}
