import type { ComponentType } from 'react'

/**
 * A single chapter in the feature-tour reel. Each chapter is a self-contained
 * animation component — the tour mounts only the active chapter, so chapters
 * don't need to know whether they're visible.
 *
 * Adding a new chapter:
 *   1. Write the animation in src/features/onboarding/animations/<name>.tsx
 *      (or anywhere — the registry just wants a component).
 *   2. Append an entry to FEATURE_TOUR_CHAPTERS in ./index.ts.
 *
 * No other files need to change — FeatureTourStep picks up new entries
 * automatically (dots, auto-advance, nav all derive from the array).
 */
export interface StoryChapter {
  /** Stable identifier. Used as React key and for analytics/debugging. */
  key: string
  /** Large heading shown above the stage. Lead with the outcome, not the feature name. */
  title: string
  /** Supporting line under the title. Keep it short and concrete. */
  subtitle: string
  /** Component rendering the animation. Mounted only while this chapter is active. */
  Component: ComponentType
  /** How long to stay on this chapter before auto-advancing (ms). Auto-advance
   *  is suspended while the user is hovering the stage. Tune this to roughly
   *  match the natural length of the internal animation sequence. */
  minDurationMs: number
}
