import type { NextReadyOptions, Task } from './types.ts'

/**
 * Find the best task to work on next using DFS.
 *
 * Strategy (from Overseer): find the deepest incomplete, unblocked leaf
 * in the task forest. If all children of a node are complete, the node
 * itself becomes the target. Among candidates at the same depth, pick
 * the highest priority.
 *
 * `allTasks` should be the full set of tasks in scope (one project, or
 * all projects) — the caller pre-filters by project/assignable/tags.
 */
export function findNextReady(allTasks: Task[], opts?: NextReadyOptions): Task | null {
  const ready = allTasks.filter((t) => {
    if (t.status !== 'ready') return false
    if (t.archivedAt != null) return false
    if (opts?.assignable && t.assignable !== 'either' && t.assignable !== opts.assignable) return false
    return true
  })

  if (ready.length === 0) return null

  // Build parent→children lookup for the full task set
  const childrenOf = new Map<string | null, Task[]>()
  for (const t of allTasks) {
    const key = t.parentId
    let list = childrenOf.get(key)
    if (!list) {
      list = []
      childrenOf.set(key, list)
    }
    list.push(t)
  }

  // Index all tasks by id
  const byId = new Map(allTasks.map((t) => [t.id, t]))

  // Check if a task is blocked by unmet dependencies
  const isBlocked = (t: Task): boolean => {
    for (const depId of t.dependsOn) {
      const dep = byId.get(depId)
      if (!dep || dep.status !== 'completed') return true
    }
    return false
  }

  // DFS: find deepest ready leaf. A "leaf" here means it has no
  // incomplete children (all children are completed, or it has none).
  let best: Task | null = null
  let bestDepth = -1

  const visit = (task: Task, depth: number): void => {
    if (task.status !== 'ready') return
    if (isBlocked(task)) return

    const children = childrenOf.get(task.id) ?? []
    const incompleteChildren = children.filter(
      (c) => c.status !== 'completed' && c.status !== 'failed' && c.archivedAt == null,
    )

    if (incompleteChildren.length > 0) {
      // This task has unfinished children — recurse into ready ones
      for (const child of incompleteChildren) {
        visit(child, depth + 1)
      }
      return
    }

    // This is a leaf (or all children are done) — candidate
    if (depth > bestDepth || (depth === bestDepth && best != null && task.priority > best.priority)) {
      best = task
      bestDepth = depth
    }
  }

  // Start DFS from root-level ready tasks
  for (const task of ready) {
    const depth = getDepth(task, byId)
    visit(task, depth)
  }

  return best
}

function getDepth(task: Task, byId: Map<string, Task>): number {
  let depth = 0
  let current = task
  while (current.parentId != null) {
    const parent = byId.get(current.parentId)
    if (!parent) break
    depth++
    current = parent
  }
  return depth
}
