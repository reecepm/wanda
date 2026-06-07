import { AnimatePresence, motion, useAnimationControls } from 'motion/react'
import { type RefObject, useEffect, useRef, useState } from 'react'

/**
 * A "story-esque" animated mini-UI showcasing review mode. The sequence:
 *
 *   1. Mock pod page shows with a "Review" button in the toolbar.
 *   2. A cursor moves to the Review button and clicks.
 *   3. The mock pod page swaps to a mock review page (file tree + diff).
 *   4. The cursor clicks a gutter line, a comment textbox appears.
 *   5. Text types itself into the textbox.
 *   6. The cursor clicks Send.
 *   7. A comment card appears; then the cursor clicks "Send to Agent".
 *   8. An agent bubble fades in.
 *
 * The whole sequence loops. This is intentionally non-interactive — users
 * just watch. A Replay button lets them start over if they want.
 *
 * Cursor alignment: we keep refs on every click target and measure their
 * actual bounding box relative to the stage before animating the cursor to
 * them. This makes the cursor land *exactly* on the element regardless of
 * stage size or content reflow (hardcoded percentages were off by 5–10%).
 *
 * The cursor SVG is drawn so the arrow tip is at (0, 0) within the SVG, and
 * the containing div has no translate offset — so setting `left/top` to a
 * pixel position puts the tip directly at that point.
 */

type Phase =
  | 'idle'
  | 'hovering-review'
  | 'on-review-page'
  | 'hovering-gutter'
  | 'comment-open'
  | 'typing'
  | 'sending'
  | 'comment-saved'
  | 'hovering-send-agent'
  | 'agent-created'

const COMMENT_TEXT = "Let's add error handling here."

export function ReviewModeStory() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [typed, setTyped] = useState('')
  const [replayToken, setReplayToken] = useState(0)
  const cursor = useAnimationControls()

  const stageRef = useRef<HTMLDivElement>(null)
  const reviewBtnRef = useRef<HTMLDivElement>(null)
  const diffTargetRef = useRef<HTMLDivElement>(null)
  const sendBtnRef = useRef<HTMLDivElement>(null)
  const sendToAgentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    function wait(ms: number) {
      return new Promise<void>((r) => setTimeout(r, ms))
    }

    /** Wait for the next animation frame so DOM updates from setPhase are committed. */
    function nextFrame() {
      return new Promise<void>((r) => requestAnimationFrame(() => r()))
    }

    /**
     * Returns the center of `ref` expressed in pixels relative to the stage.
     * Returns null if either element isn't mounted yet.
     */
    function centerOf(ref: RefObject<HTMLElement | null>): { x: number; y: number } | null {
      if (!stageRef.current || !ref.current) return null
      const stage = stageRef.current.getBoundingClientRect()
      const target = ref.current.getBoundingClientRect()
      return {
        x: target.left + target.width / 2 - stage.left,
        y: target.top + target.height / 2 - stage.top,
      }
    }

    async function moveCursorTo(ref: RefObject<HTMLElement | null>, duration = 0.9) {
      // Wait two frames: one for React commit, one for layout.
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
      // Reset to initial state
      setPhase('idle')
      setTyped('')
      // Park cursor somewhere offscreen-ish below-right, invisible
      const stage = stageRef.current?.getBoundingClientRect()
      const startX = stage ? stage.width * 0.7 : 0
      const startY = stage ? stage.height * 0.85 : 0
      await cursor.start({ left: startX, top: startY, opacity: 0, scale: 1 }, { duration: 0 })
      if (cancelled) return
      await wait(400)

      // 1. Cursor fades in and moves to the Review button
      await cursor.start({ opacity: 1 }, { duration: 0.25 })
      await moveCursorTo(reviewBtnRef, 1.0)
      if (cancelled) return
      setPhase('hovering-review')
      await wait(300)
      await clickPulse()
      if (cancelled) return

      // 2. Switch to review page
      setPhase('on-review-page')
      await wait(700)

      // 3. Cursor moves to the highlighted diff line
      await moveCursorTo(diffTargetRef, 0.9)
      if (cancelled) return
      setPhase('hovering-gutter')
      await wait(250)
      await clickPulse()
      if (cancelled) return

      // 4. Comment textbox opens
      setPhase('comment-open')
      await wait(400)

      // 5. Type comment
      setPhase('typing')
      for (let i = 1; i <= COMMENT_TEXT.length; i++) {
        if (cancelled) return
        setTyped(COMMENT_TEXT.slice(0, i))
        await wait(40)
      }
      await wait(400)

      // 6. Cursor moves to Send button inside the comment box
      await moveCursorTo(sendBtnRef, 0.8)
      if (cancelled) return
      setPhase('sending')
      await clickPulse()
      if (cancelled) return

      // 7. Comment is saved
      setPhase('comment-saved')
      await wait(600)

      // 8. Cursor moves to "Send to Agent" button at bottom
      await moveCursorTo(sendToAgentRef, 0.9)
      if (cancelled) return
      setPhase('hovering-send-agent')
      await wait(250)
      await clickPulse()
      if (cancelled) return

      setPhase('agent-created')
      await wait(2500)
      if (cancelled) return

      // Fade cursor out and loop
      await cursor.start({ opacity: 0 }, { duration: 0.3 })
      if (cancelled) return
      setReplayToken((t) => t + 1)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [cursor, replayToken])

  const onReviewPage =
    phase === 'on-review-page' ||
    phase === 'hovering-gutter' ||
    phase === 'comment-open' ||
    phase === 'typing' ||
    phase === 'sending' ||
    phase === 'comment-saved' ||
    phase === 'hovering-send-agent' ||
    phase === 'agent-created'

  const commentOpen =
    phase === 'comment-open' ||
    phase === 'typing' ||
    phase === 'sending' ||
    phase === 'comment-saved' ||
    phase === 'hovering-send-agent' ||
    phase === 'agent-created'

  const commentSaved = phase === 'comment-saved' || phase === 'hovering-send-agent' || phase === 'agent-created'

  return (
    <div className="relative w-full">
      {/* Stage — flex column so the body fills exactly the space below the
          toolbar, regardless of the toolbar's actual rendered height. Uses
          16:9 so the stage stays within the shell's vertical budget at its
          full max-w-5xl width. Width is controlled by the shell's step
          container; the chapter itself is just `w-full`. */}
      <div
        ref={stageRef}
        className="relative flex aspect-[16/9] w-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 shadow-2xl shadow-black/40"
      >
        {/* Pod toolbar */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 px-3.5 py-2">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-zinc-700" />
            <span className="size-2 rounded-full bg-zinc-700" />
            <span className="size-2 rounded-full bg-zinc-700" />
            <span className="ml-2 text-xs text-zinc-500">my-app / feature-branch</span>
          </div>
          <motion.div
            ref={reviewBtnRef}
            animate={
              phase === 'hovering-review'
                ? { backgroundColor: 'rgba(245,158,11,0.25)', borderColor: 'rgba(245,158,11,0.6)' }
                : { backgroundColor: 'rgba(39,39,42,0.8)', borderColor: 'rgba(82,82,91,0.6)' }
            }
            transition={{ duration: 0.2 }}
            className="rounded-sm border px-2.5 py-1 text-[11px] text-zinc-200"
          >
            Review
          </motion.div>
        </div>

        {/* Body — flex-1 takes remaining space after the toolbar */}
        <div className="relative min-h-0 flex-1">
          <AnimatePresence mode="wait">
            {!onReviewPage ? (
              // Pod page mock — simple terminal feel
              <motion.div
                key="pod-page"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col gap-1 bg-zinc-950/60 p-4 font-mono text-xs text-zinc-500"
              >
                <div>$ bun run dev</div>
                <div className="text-emerald-400/80">✓ ready in 412ms</div>
                <div className="text-zinc-600">➜ Local: http://localhost:5173</div>
                <div className="mt-1 text-zinc-700">watching for changes…</div>
              </motion.div>
            ) : (
              // Review page mock
              <motion.div
                key="review-page"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
                className="absolute inset-0 flex bg-zinc-950/60"
              >
                {/* File tree */}
                <div className="w-[22%] border-r border-zinc-800 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-600">Changed</div>
                  <div className="mt-1.5 flex flex-col gap-1 text-xs">
                    <div className="truncate text-amber-400/80">api.ts</div>
                    <div className="truncate text-zinc-500">app.tsx</div>
                    <div className="truncate text-zinc-600">utils.ts</div>
                  </div>
                </div>
                {/* Diff */}
                <div className="flex-1 p-3">
                  <div className="text-[10px] text-zinc-600">api.ts</div>
                  <div className="mt-1.5 flex flex-col gap-1 font-mono text-xs">
                    <DiffLine kind="context" gutter="12" text="async function fetchUser(id) {" />
                    <DiffLine
                      ref={diffTargetRef}
                      kind="add"
                      gutter="13"
                      text="  const res = await fetch(`/api/u/${id}`)"
                      highlight={phase === 'hovering-gutter' || phase === 'comment-open' || phase === 'typing'}
                    />
                    <DiffLine kind="add" gutter="14" text="  return res.json()" />
                    <DiffLine kind="context" gutter="15" text="}" />
                  </div>

                  {/* Inline comment box */}
                  <AnimatePresence>
                    {commentOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0, y: -4 }}
                        animate={{ opacity: 1, height: 'auto', y: 0 }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="mt-1.5 overflow-hidden rounded-sm border border-zinc-800 bg-zinc-900/80"
                      >
                        {commentSaved ? (
                          // Saved comment card
                          <div className="flex items-start gap-2 px-2 py-1.5 text-xs">
                            <div className="size-4 rounded-full bg-gradient-to-br from-amber-400 to-orange-500" />
                            <div className="flex-1 text-zinc-300">{COMMENT_TEXT}</div>
                          </div>
                        ) : (
                          // Active input
                          <div className="flex flex-col gap-1.5 p-2">
                            <div className="min-h-[16px] text-xs text-zinc-300">
                              {typed}
                              <motion.span
                                animate={{ opacity: [1, 0, 1] }}
                                transition={{ duration: 0.8, repeat: Infinity }}
                                className="ml-0.5 inline-block h-[11px] w-[1px] bg-zinc-400 align-middle"
                              />
                            </div>
                            <div className="flex justify-end">
                              <motion.div
                                ref={sendBtnRef}
                                animate={
                                  phase === 'sending'
                                    ? { backgroundColor: 'rgba(245,158,11,0.3)' }
                                    : { backgroundColor: 'rgba(63,63,70,0.6)' }
                                }
                                className="rounded-sm px-2 py-0.5 text-[11px] text-zinc-200"
                              >
                                Send
                              </motion.div>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom bar — Send to Agent */}
          <AnimatePresence>
            {commentSaved && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-zinc-800/80 bg-zinc-900/80 px-4 py-2"
              >
                <span className="text-xs text-zinc-500">1 comment • local review</span>
                <motion.div
                  ref={sendToAgentRef}
                  animate={
                    phase === 'hovering-send-agent'
                      ? { backgroundColor: 'rgba(245,158,11,0.3)', borderColor: 'rgba(245,158,11,0.6)' }
                      : { backgroundColor: 'rgba(39,39,42,0.8)', borderColor: 'rgba(82,82,91,0.6)' }
                  }
                  transition={{ duration: 0.2 }}
                  className="rounded-sm border px-2.5 py-1 text-[11px] text-zinc-200"
                >
                  Send to Agent
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Agent created badge */}
          <AnimatePresence>
            {phase === 'agent-created' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5 shadow-lg shadow-emerald-500/10 backdrop-blur-sm"
              >
                <div className="flex items-center gap-2.5">
                  <div className="size-5 rounded-full bg-gradient-to-br from-amber-400 to-orange-500" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-emerald-200">Agent created</span>
                    <span className="text-[11px] text-emerald-300/70">Reviewing 1 comment…</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/*
          Cursor. The SVG viewBox is shifted so the arrow tip sits exactly at
          (0, 0) of the containing div. No translate offset — setting left/top
          to a pixel position puts the tip directly on that pixel.
        */}
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

interface DiffLineProps {
  kind: 'context' | 'add' | 'del'
  gutter: string
  text: string
  highlight?: boolean
  ref?: RefObject<HTMLDivElement | null>
}

function DiffLine({ kind, gutter, text, highlight, ref }: DiffLineProps) {
  const bg =
    kind === 'add'
      ? highlight
        ? 'bg-amber-500/20'
        : 'bg-emerald-500/10'
      : kind === 'del'
        ? 'bg-red-500/10'
        : 'bg-transparent'
  const mark = kind === 'add' ? '+' : kind === 'del' ? '-' : ' '
  return (
    <div ref={ref} className={`flex items-center gap-2.5 rounded-sm px-1.5 py-[1px] ${bg}`}>
      <span className="w-5 text-right text-[10px] text-zinc-600">{gutter}</span>
      <span className="w-2.5 text-zinc-500">{mark}</span>
      <span className="text-zinc-400">{text}</span>
    </div>
  )
}
