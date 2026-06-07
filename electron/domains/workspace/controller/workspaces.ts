import { Context, Effect, Layer } from 'effect'
import { DatabaseService } from '../../../infra/database'
import { resolveIconUrlFromRepo } from '../icon-resolver'
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspaceById,
  listWorkspaces,
  updateWorkspace,
  type WorkspaceRow,
  type WorkspaceUpdateInput,
} from '../repository'

interface WorkspaceControllerShape {
  readonly list: () => Effect.Effect<WorkspaceRow[]>
  readonly getById: (id: string) => Effect.Effect<WorkspaceRow | undefined>
  readonly create: (input: { name: string; cwd: string; repoPath?: string }) => Effect.Effect<WorkspaceRow>
  readonly update: (id: string, input: WorkspaceUpdateInput) => Effect.Effect<WorkspaceRow>
  readonly delete: (id: string) => Effect.Effect<void>
  readonly refreshIcon: (id: string) => Effect.Effect<WorkspaceRow | undefined>
  readonly refreshAllIcons: () => Effect.Effect<{ updated: number }>
}

export class WorkspaceController extends Context.Tag('WorkspaceController')<
  WorkspaceController,
  WorkspaceControllerShape
>() {}

export const WorkspaceControllerLive = Layer.effect(
  WorkspaceController,
  Effect.gen(function* () {
    const db = yield* DatabaseService

    return {
      list: () => Effect.sync(() => listWorkspaces(db)),
      getById: (id) => Effect.sync(() => getWorkspaceById(db, id)),
      create: (input) =>
        Effect.gen(function* () {
          const lookup = input.repoPath ?? input.cwd
          const iconUrl = yield* Effect.tryPromise({
            try: () => resolveIconUrlFromRepo(lookup),
            catch: () => null,
          }).pipe(Effect.catchAll(() => Effect.succeed(null)))
          return createWorkspace(db, { ...input, iconUrl })
        }),
      update: (id, input) => Effect.sync(() => updateWorkspace(db, id, input)),
      delete: (id) => Effect.sync(() => deleteWorkspace(db, id)),
      refreshIcon: (id) =>
        Effect.gen(function* () {
          const ws = getWorkspaceById(db, id)
          if (!ws) return undefined
          const lookup = ws.repoPath ?? ws.cwd
          const iconUrl = yield* Effect.tryPromise({
            try: () => resolveIconUrlFromRepo(lookup),
            catch: () => null,
          }).pipe(Effect.catchAll(() => Effect.succeed(null)))
          return updateWorkspace(db, id, { iconUrl })
        }),
      refreshAllIcons: () =>
        Effect.gen(function* () {
          const all = listWorkspaces(db)
          let updated = 0
          for (const ws of all) {
            const lookup = ws.repoPath ?? ws.cwd
            const iconUrl = yield* Effect.tryPromise({
              try: () => resolveIconUrlFromRepo(lookup),
              catch: () => null,
            }).pipe(Effect.catchAll(() => Effect.succeed(null)))
            if (iconUrl !== ws.iconUrl) {
              updateWorkspace(db, ws.id, { iconUrl })
              updated++
            }
          }
          return { updated }
        }),
    }
  }),
)
