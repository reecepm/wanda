// -----------------------------------------------------------------------------
// `SecretsService` — Effect wrapper around the at-rest secret-store module
// for per-provider API keys.
//
// Rules:
//   * Plaintext is write-only from the client side. `readApiKey` is for
//     server-side code (providers) only and returns `null` when no key is
//     available.
//   * Env-var fallback (`ANTHROPIC_API_KEY`, etc.) is honoured when no stored
//     key exists; env-backed keys cannot be rotated via `setApiKey`.
//   * `onChange` is a cheap subscription used by long-lived providers to
//     reconfigure their SDK client without restart.
// -----------------------------------------------------------------------------

import { Context, Effect, Layer } from 'effect'
import { DatabaseService } from '../../infra/database'
import { decryptSecret, encryptSecret } from '../../infra/secret-store'
import { log } from '../../packages/logger'
import { ValidationError } from '../../services/errors'
import { deleteProviderSecret, getProviderSecret, listProviderSecrets, upsertProviderSecret } from './repository'
import { PROVIDER_ENV_FALLBACKS, type ProviderSecretStatus } from './types'

type SecretChangeListener = (providerId: string) => void

interface SecretsServiceShape {
  /**
   * Read the plaintext API key for a provider. Prefers the stored row;
   * falls back to the env var from `PROVIDER_ENV_FALLBACKS`. Returns null
   * when neither is available.
   *
   * Server-side use only.
   */
  readonly readApiKey: (providerId: string) => Effect.Effect<string | null>

  /** Persist a new ciphertext for `providerId`. Overwrites any existing row. */
  readonly setApiKey: (providerId: string, plaintext: string) => Effect.Effect<void, ValidationError>

  /** Drop the stored row for `providerId`. Env-var fallback (if any) stays in effect. */
  readonly removeApiKey: (providerId: string) => Effect.Effect<void>

  /** Cheap status query for the settings UI. Never returns plaintext. */
  readonly getStatus: (providerId: string) => Effect.Effect<ProviderSecretStatus>

  /** List status for every provider that has either a stored row or a known env fallback. */
  readonly listStatus: () => Effect.Effect<ProviderSecretStatus[]>

  /** Subscribe to set/remove events. Returns an unsubscribe. Sync, non-Effect. */
  readonly onChange: (listener: SecretChangeListener) => () => void
}

export class SecretsService extends Context.Tag('SecretsService')<SecretsService, SecretsServiceShape>() {}

export const SecretsServiceLive = Layer.effect(
  SecretsService,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const listeners = new Set<SecretChangeListener>()

    const notify = (providerId: string): void => {
      for (const listener of listeners) {
        try {
          listener(providerId)
        } catch (err) {
          log.main.warn('SecretsService listener threw', { providerId, err })
        }
      }
    }

    const readStored = (providerId: string): string | null => {
      const row = getProviderSecret(db, providerId)
      if (!row) return null
      try {
        return decryptSecret(row.ciphertext)
      } catch (err) {
        log.main.error(`SecretsService: decrypt failed for ${providerId}`, err)
        return null
      }
    }

    const readEnv = (providerId: string): string | null => {
      const name = PROVIDER_ENV_FALLBACKS[providerId]
      if (!name) return null
      const value = process.env[name]
      return value && value.length > 0 ? value : null
    }

    const getStatus = (providerId: string): ProviderSecretStatus => {
      const row = getProviderSecret(db, providerId)
      if (row) {
        return {
          providerId,
          hasKey: true,
          source: 'stored',
          updatedAt: row.updatedAt.getTime(),
        }
      }
      if (readEnv(providerId)) {
        return { providerId, hasKey: true, source: 'env', updatedAt: null }
      }
      return { providerId, hasKey: false, source: null, updatedAt: null }
    }

    return {
      readApiKey: (providerId) => Effect.sync(() => readStored(providerId) ?? readEnv(providerId)),

      setApiKey: (providerId, plaintext) =>
        Effect.gen(function* () {
          if (!plaintext || plaintext.length === 0) {
            return yield* new ValidationError({
              field: 'plaintext',
              message: 'SecretsService.setApiKey: plaintext must be non-empty',
            })
          }
          const ciphertext = encryptSecret(plaintext)
          const now = new Date()
          upsertProviderSecret(db, { providerId, ciphertext, updatedAt: now })
          notify(providerId)
        }),

      removeApiKey: (providerId) =>
        Effect.sync(() => {
          deleteProviderSecret(db, providerId)
          notify(providerId)
        }),

      getStatus: (providerId) => Effect.sync(() => getStatus(providerId)),

      listStatus: () =>
        Effect.sync(() => {
          const rows = listProviderSecrets(db)
          const seen = new Set(rows.map((r) => r.providerId))
          const stored: ProviderSecretStatus[] = rows.map((r) => ({
            providerId: r.providerId,
            hasKey: true,
            source: 'stored',
            updatedAt: r.updatedAt.getTime(),
          }))
          const envOnly: ProviderSecretStatus[] = []
          for (const providerId of Object.keys(PROVIDER_ENV_FALLBACKS)) {
            if (seen.has(providerId)) continue
            if (readEnv(providerId)) {
              envOnly.push({ providerId, hasKey: true, source: 'env', updatedAt: null })
            }
          }
          return [...stored, ...envOnly]
        }),

      onChange: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    }
  }),
)
