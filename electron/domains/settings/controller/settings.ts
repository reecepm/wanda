import { Context, Effect, Layer } from 'effect'
import { DatabaseService } from '../../../infra/database'
import { getManySettings, getSetting, setSetting } from '../repository'

interface SettingsControllerShape {
  readonly get: (key: string) => Effect.Effect<string | null>
  readonly getMany: (keys: string[]) => Effect.Effect<Record<string, string | null>>
  readonly set: (key: string, value: string | null) => Effect.Effect<void>
}

export class SettingsController extends Context.Tag('SettingsController')<
  SettingsController,
  SettingsControllerShape
>() {}

export const SettingsControllerLive = Layer.effect(
  SettingsController,
  Effect.gen(function* () {
    const db = yield* DatabaseService

    return {
      get: (key) => Effect.sync(() => getSetting(db, key)),
      getMany: (keys) => Effect.sync(() => getManySettings(db, keys)),
      set: (key, value) => Effect.sync(() => setSetting(db, key, value)),
    }
  }),
)
