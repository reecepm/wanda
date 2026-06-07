import { Context, Effect, Layer } from 'effect'
import { DatabaseService } from '../../../infra/database'
import {
  getSettingsByWorkspace,
  upsertSettings,
  type WorkspaceSettingsRow,
  type WorkspaceSettingsUpdateInput,
} from '../repository'

interface WorkspaceSettingsControllerShape {
  readonly getByWorkspace: (workspaceId: string) => Effect.Effect<WorkspaceSettingsRow | undefined>
  readonly upsert: (workspaceId: string, input: WorkspaceSettingsUpdateInput) => Effect.Effect<WorkspaceSettingsRow>
}

export class WorkspaceSettingsController extends Context.Tag('WorkspaceSettingsController')<
  WorkspaceSettingsController,
  WorkspaceSettingsControllerShape
>() {}

export const WorkspaceSettingsControllerLive = Layer.effect(
  WorkspaceSettingsController,
  Effect.gen(function* () {
    const db = yield* DatabaseService

    return {
      getByWorkspace: (workspaceId) => Effect.sync(() => getSettingsByWorkspace(db, workspaceId)),
      upsert: (workspaceId, input) => Effect.sync(() => upsertSettings(db, workspaceId, input)),
    }
  }),
)
