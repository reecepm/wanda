import { Context, Effect, Layer } from 'effect'
import { DatabaseService } from '../../../infra/database'
import { AppError } from '../../../services/errors'
import { PodCrudController, type PodRow } from '../../pod'
import { SettingsController } from '../../settings'
import { getPresetByKey, ONBOARDING_PRESETS } from '../presets'
import { updateTemplateDefaultView } from '../repository'

const KEY_COMPLETED = 'onboarding.completed'
const KEY_DEFAULT_TEMPLATE = 'template.defaultId'

/** The requested onboarding preset key does not exist. */
class UnknownOnboardingPreset extends AppError('UnknownOnboardingPreset', 'NOT_FOUND')<{
  readonly presetKey: string
}> {}

export interface OnboardingControllerShape {
  readonly getStatus: () => Effect.Effect<{
    completed: boolean
    defaultTemplateId: string | null
    presets: Array<{
      order: number
      key: string
      name: string
      tagline: string
      description: string
      viewType: (typeof ONBOARDING_PRESETS)[number]['viewType']
    }>
  }>
  readonly createPresetTemplate: (presetKey: string) => Effect.Effect<PodRow, UnknownOnboardingPreset>
  readonly setDefaultTemplate: (templateId: string | null) => Effect.Effect<void>
  readonly finish: () => Effect.Effect<void>
  readonly reset: () => Effect.Effect<void>
}

export class OnboardingController extends Context.Tag('OnboardingController')<
  OnboardingController,
  OnboardingControllerShape
>() {}

export const OnboardingControllerLive = Layer.effect(
  OnboardingController,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const pods = yield* PodCrudController
    const settings = yield* SettingsController

    return {
      getStatus: () =>
        Effect.gen(function* () {
          const values = yield* settings.getMany([KEY_COMPLETED, KEY_DEFAULT_TEMPLATE])
          return {
            completed: values[KEY_COMPLETED] === 'true',
            defaultTemplateId: values[KEY_DEFAULT_TEMPLATE] ?? null,
            presets: ONBOARDING_PRESETS.map((p) => ({
              order: p.order,
              key: p.key,
              name: p.name,
              tagline: p.tagline,
              description: p.description,
              viewType: p.viewType,
            })),
          }
        }),

      createPresetTemplate: (presetKey) =>
        Effect.gen(function* () {
          const preset = getPresetByKey(presetKey)
          if (!preset) {
            return yield* new UnknownOnboardingPreset({
              presetKey,
              message: `Unknown onboarding preset: ${presetKey}`,
            })
          }

          const template = yield* pods.createTemplate({
            name: preset.name,
            description: preset.description,
            workspaceId: null,
            cwd: '',
          })

          updateTemplateDefaultView(db, {
            podId: template.id,
            viewType: preset.viewType,
            config: preset.defaultConfig,
          })

          yield* settings.set(KEY_DEFAULT_TEMPLATE, template.id)
          return template
        }),

      setDefaultTemplate: (templateId) => settings.set(KEY_DEFAULT_TEMPLATE, templateId),

      finish: () => settings.set(KEY_COMPLETED, 'true'),

      reset: () =>
        Effect.gen(function* () {
          yield* Effect.all([settings.set(KEY_COMPLETED, null), settings.set(KEY_DEFAULT_TEMPLATE, null)])
        }),
    }
  }),
)
