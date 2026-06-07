import { PodsStory } from '../animations/pods-story'
import { ReviewModeStory } from '../animations/review-mode-story'
import { TasksStory } from '../animations/tasks-story'
import type { StoryChapter } from './types'

/**
 * Ordered list of chapters in the feature tour. The tour plays them one at
 * a time, auto-advancing after each chapter's `minDurationMs` while the
 * user isn't hovering the stage.
 *
 * To add a new chapter: import its component and append an entry. No other
 * file changes required.
 *
 * Ordering tip: lead with the chapter that best explains what makes Wanda
 * *different*, not just what it does. Pods+items is a good opener because
 * the view-switching reflow sells the core concept in ~8 seconds; review
 * mode and tasks build on that with feature-level stories.
 */
export const FEATURE_TOUR_CHAPTERS: StoryChapter[] = [
  {
    key: 'pods',
    title: 'Your workspace, your way',
    subtitle: 'Group terminals, agents, and browsers into a pod. View them however fits.',
    Component: PodsStory,
    minDurationMs: 13500,
  },
  {
    key: 'review-mode',
    title: 'Review mode',
    subtitle: 'Turn local diffs into agent actions, without leaving the app.',
    Component: ReviewModeStory,
    minDurationMs: 14000,
  },
  {
    key: 'tasks',
    title: 'Tasks, your way',
    subtitle: 'Share tasks across pods and agents, or keep them scoped to one. List or kanban, you pick.',
    Component: TasksStory,
    minDurationMs: 11000,
  },
]

export type { StoryChapter } from './types'
