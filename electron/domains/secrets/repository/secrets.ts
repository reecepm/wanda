import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../../../db/connection'
import { providerSecrets } from '../../../db/schema'

type ProviderSecretRow = typeof providerSecrets.$inferSelect

export function getProviderSecret(db: AppDatabase, providerId: string): ProviderSecretRow | undefined {
  return db.select().from(providerSecrets).where(eq(providerSecrets.providerId, providerId)).get()
}

export function upsertProviderSecret(
  db: AppDatabase,
  input: {
    providerId: string
    ciphertext: string
    updatedAt: Date
  },
) {
  db.insert(providerSecrets)
    .values(input)
    .onConflictDoUpdate({
      target: providerSecrets.providerId,
      set: {
        ciphertext: input.ciphertext,
        updatedAt: input.updatedAt,
      },
    })
    .run()
}

export function deleteProviderSecret(db: AppDatabase, providerId: string) {
  db.delete(providerSecrets).where(eq(providerSecrets.providerId, providerId)).run()
}

export function listProviderSecrets(db: AppDatabase): ProviderSecretRow[] {
  return db.select().from(providerSecrets).all()
}
