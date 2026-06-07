import { z } from 'zod'
import { OnboardingController } from '../../services'
import type { AppRouterDeps } from '../index'

export function onboardingRoutes({ effectOs }: AppRouterDeps) {
  return {
    getStatus: effectOs.effect(function* () {
      const onboarding = yield* OnboardingController
      return yield* onboarding.getStatus()
    }),

    createPresetTemplate: effectOs.input(z.object({ presetKey: z.string() })).effect(function* ({ input }) {
      const onboarding = yield* OnboardingController
      return yield* onboarding.createPresetTemplate(input.presetKey)
    }),

    setDefaultTemplate: effectOs.input(z.object({ templateId: z.string().nullable() })).effect(function* ({ input }) {
      const onboarding = yield* OnboardingController
      yield* onboarding.setDefaultTemplate(input.templateId)
      return { ok: true as const }
    }),

    finish: effectOs.effect(function* () {
      const onboarding = yield* OnboardingController
      yield* onboarding.finish()
      return { ok: true as const }
    }),

    reset: effectOs.effect(function* () {
      const onboarding = yield* OnboardingController
      yield* onboarding.reset()
      return { ok: true as const }
    }),
  }
}
