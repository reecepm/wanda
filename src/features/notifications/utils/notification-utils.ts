/** Priority ordering for notification sort: blocking first, then urgent, then info */
export const priorityOrder: Record<string, number> = { blocking: 0, urgent: 1, info: 2 }

/** Sort notifications by priority (blocking > urgent > info), then oldest-first within the same priority */
export function sortByPriority<T extends { priority: string; createdAt: unknown }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 2
    const pb = priorityOrder[b.priority] ?? 2
    if (pa !== pb) return pa - pb
    return new Date(a.createdAt as string | number).getTime() - new Date(b.createdAt as string | number).getTime()
  })
}
