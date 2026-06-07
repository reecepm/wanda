import { AnimatePresence, motion, useAnimationControls } from 'motion/react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { RiCheckLine, RiLayoutGridLine, RiListCheck3 } from '@/lib/icons'

/**
 * Feature tour chapter: task management (list ↔ kanban).
 *
 * Narrative:
 *   1. A Linear-style list of tasks with status + priority.
 *   2. Cursor clicks the view toggle. Tasks reflow into three Kanban columns
 *      (Todo / In progress / Done) via `layoutId` — each card animates from
 *      its list position to its new column slot.
 *   3. Cursor grabs the top "In progress" card and drags it to "Done". We
 *      fake the drag by updating the task's status mid-animation, which
 *      causes layoutId to animate the card into its new column automatically.
 *   4. Hold, loop.
 *
 * Same machinery as pods-story / review-mode-story: refs for click targets,
 * centerOf() helper, phase state, cursor animation controls.
 */

type TaskStatus = 'todo' | 'in-progress' | 'done'

interface Task {
  id: string
  title: string
  status: TaskStatus
}

const INITIAL_TASKS: Task[] = [
  { id: 't1', title: 'Refactor auth middleware', status: 'in-progress' },
  { id: 't2', title: 'Fix token refresh bug', status: 'in-progress' },
  { id: 't3', title: 'Add dark mode toggle', status: 'todo' },
  { id: 't4', title: 'Optimize bundle size', status: 'todo' },
  { id: 't5', title: 'Upgrade React 19', status: 'done' },
  { id: 't6', title: 'Write API docs', status: 'done' },
]

type Phase = 'idle' | 'list' | 'hovering-toggle' | 'kanban' | 'hovering-card' | 'dragging' | 'dropped' | 'done'

/** ID of the task we'll drag from "In progress" → "Done" during the story. */
const DRAG_TARGET_ID = 't1'

export function TasksStory() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS)
  const [replayToken, setReplayToken] = useState(0)
  const cursor = useAnimationControls()

  const stageRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLDivElement>(null)
  const dragCardRef = useRef<HTMLDivElement>(null)
  const doneColumnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    function wait(ms: number) {
      return new Promise<void>((r) => setTimeout(r, ms))
    }

    function nextFrame() {
      return new Promise<void>((r) => requestAnimationFrame(() => r()))
    }

    function centerOf(ref: RefObject<HTMLElement | null>): { x: number; y: number } | null {
      if (!stageRef.current || !ref.current) return null
      const stage = stageRef.current.getBoundingClientRect()
      const target = ref.current.getBoundingClientRect()
      return {
        x: target.left + target.width / 2 - stage.left,
        y: target.top + target.height / 2 - stage.top,
      }
    }

    async function moveCursorTo(ref: RefObject<HTMLElement | null>, duration = 0.8) {
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
      setTasks(INITIAL_TASKS)
      setPhase('idle')

      const stage = stageRef.current?.getBoundingClientRect()
      const startX = stage ? stage.width * 0.5 : 0
      const startY = stage ? stage.height * 0.85 : 0
      await cursor.start({ left: startX, top: startY, opacity: 0, scale: 1 }, { duration: 0 })
      if (cancelled) return
      await wait(300)

      // 1. Show list view
      setPhase('list')
      await wait(200)
      await cursor.start({ opacity: 1 }, { duration: 0.25 })
      await wait(1800)

      // 2. Click view toggle → reflow into kanban
      await moveCursorTo(toggleRef, 0.8)
      if (cancelled) return
      setPhase('hovering-toggle')
      await wait(250)
      await clickPulse()
      if (cancelled) return

      setPhase('kanban')
      // Give the layout animation time to settle
      await wait(1200)

      // 3. Move to the drag target (top in-progress card)
      await moveCursorTo(dragCardRef, 0.7)
      if (cancelled) return
      setPhase('hovering-card')
      await wait(300)
      // Grab — cursor dips slightly to signify "picked up"
      await cursor.start({ scale: [1, 0.9, 0.95] }, { duration: 0.25 })
      if (cancelled) return
      setPhase('dragging')

      // 4. Drag to the done column. The card follows the cursor via layoutId
      //    once we flip its status. We drive the cursor first, then flip the
      //    status right before the cursor arrives — the card visibly travels
      //    with the cursor.
      await moveCursorTo(doneColumnRef, 0.9)
      if (cancelled) return
      // Drop: change the task's status — layoutId animates into the Done column.
      setTasks((prev) => prev.map((t) => (t.id === DRAG_TARGET_ID ? { ...t, status: 'done' } : t)))
      setPhase('dropped')
      await cursor.start({ scale: [0.95, 1] }, { duration: 0.25 })
      if (cancelled) return
      await wait(2000)
      setPhase('done')

      // Fade cursor and loop
      await cursor.start({ opacity: 0 }, { duration: 0.3 })
      if (cancelled) return
      setReplayToken((t) => t + 1)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [cursor, replayToken])

  const isKanban =
    phase === 'kanban' || phase === 'hovering-card' || phase === 'dragging' || phase === 'dropped' || phase === 'done'

  return (
    <div className="relative w-full">
      <div
        ref={stageRef}
        className="relative flex aspect-[16/9] w-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 shadow-2xl shadow-black/40"
      >
        {/* Toolbar */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 px-3.5 py-2">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-zinc-700" />
            <span className="size-2 rounded-full bg-zinc-700" />
            <span className="size-2 rounded-full bg-zinc-700" />
            <span className="ml-2 text-xs text-zinc-500">Tasks</span>
          </div>
          <motion.div
            ref={toggleRef}
            animate={
              phase === 'hovering-toggle'
                ? { backgroundColor: 'rgba(245,158,11,0.25)', borderColor: 'rgba(245,158,11,0.6)' }
                : { backgroundColor: 'rgba(39,39,42,0.8)', borderColor: 'rgba(82,82,91,0.6)' }
            }
            transition={{ duration: 0.2 }}
            className="flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] text-zinc-300"
          >
            {isKanban ? <RiLayoutGridLine className="size-3.5" /> : <RiListCheck3 className="size-3.5" />}
            <span>{isKanban ? 'Kanban' : 'List'}</span>
          </motion.div>
        </div>

        {/*
          Body.

          The list→kanban transition is a simple crossfade between two fully
          independent trees. Cards in the LIST view do NOT use `layoutId` —
          if they did, framer would try to morph each list row into its
          matching kanban card (different width, different column), warping
          the card during the transition.

          Kanban cards DO use `layoutId`, but only within the kanban tree.
          This is what makes the drag-to-done move animate (same task id
          appears in the "In progress" column, then the "Done" column;
          framer tweens between the two positions).
        */}
        <div className="relative min-h-0 flex-1 p-4">
          <AnimatePresence mode="wait">
            {isKanban ? (
              <motion.div
                key="kanban"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="grid h-full grid-cols-3 gap-2"
              >
                {(['todo', 'in-progress', 'done'] as TaskStatus[]).map((col) => {
                  const columnTasks = tasks.filter((t) => t.status === col)
                  return (
                    <div
                      key={col}
                      ref={col === 'done' ? doneColumnRef : undefined}
                      className="flex flex-col gap-1.5 rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2"
                    >
                      <div className="flex items-center justify-between px-1 py-0.5">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                          {columnTitle(col)}
                        </span>
                        <span className="text-[10px] text-zinc-600">{columnTasks.length}</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {columnTasks.map((task) => (
                          <KanbanTaskCard
                            key={task.id}
                            task={task}
                            refEl={task.id === DRAG_TARGET_ID ? dragCardRef : undefined}
                            lifted={task.id === DRAG_TARGET_ID && phase === 'dragging'}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </motion.div>
            ) : (
              <motion.div
                key="list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="flex h-full flex-col gap-1"
              >
                {tasks.map((task) => (
                  <ListTaskCard key={task.id} task={task} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Cursor */}
        <motion.div
          animate={cursor}
          initial={{ opacity: 0, left: 0, top: 0, scale: 1 }}
          className="pointer-events-none absolute z-20"
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

/**
 * Row card for the list view. Plain element, no `layoutId` — the list view
 * crossfades as a whole to/from the kanban view.
 */
function ListTaskCard({ task }: { task: Task }) {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5 text-xs text-zinc-300">
      <StatusDot status={task.status} />
      <span className="flex-1 truncate">{task.title}</span>
    </div>
  )
}

/**
 * Column card for the kanban view. Uses `layoutId` so that when a task's
 * status changes (drag-to-done), framer animates the card from its old
 * column position to the new one. Scoped to the kanban tree — list cards
 * don't share this layoutId, so the list↔kanban transition stays a clean
 * crossfade instead of morphing each row into a narrower card.
 */
function KanbanTaskCard({
  task,
  refEl,
  lifted,
}: {
  task: Task
  refEl?: RefObject<HTMLDivElement | null>
  lifted?: boolean
}) {
  return (
    <motion.div
      ref={refEl}
      layoutId={`kanban-task-${task.id}`}
      animate={
        lifted
          ? { scale: 1.03, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }
          : { scale: 1, boxShadow: '0 0px 0px rgba(0,0,0,0)' }
      }
      transition={{
        layout: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
        default: { duration: 0.2 },
      }}
      className="flex items-center gap-2 rounded-sm border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5 text-xs text-zinc-300"
    >
      <StatusDot status={task.status} />
      <span className="flex-1 truncate">{task.title}</span>
    </motion.div>
  )
}

function StatusDot({ status }: { status: TaskStatus }) {
  if (status === 'done') {
    return (
      <span className="flex size-3.5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
        <RiCheckLine className="size-2.5" />
      </span>
    )
  }
  if (status === 'in-progress') {
    return (
      <span className="relative flex size-3.5 items-center justify-center rounded-full border-2 border-amber-500/60">
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-[-2px] rounded-full border-2 border-transparent border-t-amber-400"
        />
      </span>
    )
  }
  return <span className="size-3.5 rounded-full border-2 border-zinc-600" />
}

function columnTitle(col: TaskStatus): string {
  if (col === 'in-progress') return 'In progress'
  if (col === 'done') return 'Done'
  return 'Todo'
}
