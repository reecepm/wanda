// Public provider-secret metadata surface. Plaintexts NEVER leave the server.

export interface ProviderSecretStatus {
  readonly providerId: string
  /** True if a ciphertext row exists OR an env-var fallback is set. */
  readonly hasKey: boolean
  /** Where the key came from if present. `null` when absent. */
  readonly source: 'stored' | 'env' | null
  /** Only present for stored rows. */
  readonly updatedAt: number | null
}

/**
 * Environment-variable fallbacks. Read-only — env keys never overwrite stored
 * keys, and env-backed keys cannot be rotated via the UI.
 */
export const PROVIDER_ENV_FALLBACKS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
}
