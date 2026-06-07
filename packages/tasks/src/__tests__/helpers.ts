import type { TaskStore } from '../store.ts'
import { createTaskStore } from '../store.ts'
import { createMemoryStorage } from '../testing.ts'
import type { Project, Workspace } from '../types.ts'

export async function setupStore(name = 'test-instance'): Promise<{
  store: TaskStore
  workspace: Workspace
  project: Project
}> {
  const storage = createMemoryStorage()
  const store = await createTaskStore({ storage, instanceName: name })

  const workspace = await store.workspaces.create({ name: 'Test Workspace' })
  const project = await store.projects.create({
    name: 'Test Project',
    workspaceId: workspace.id,
    identifier: 'TST',
  })

  return { store, workspace, project }
}

/** Advance time by ms (for lease expiry testing). */
export function advanceTime(ms: number): void {
  const real = Date.now
  const offset = real.call(Date) + ms
  Date.now = () => offset
}

export function restoreTime(): void {
  // vitest handles this via vi.restoreAllMocks if needed
}
