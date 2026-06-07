// -----------------------------------------------------------------------------
// Symmetric encryption for at-rest secrets (remote-target auth tokens).
//
// Provides `encryptSecret(plaintext)` / `decryptSecret(ciphertext)` that
// domain code uses when reading/writing sensitive fields in the database.
// The actual encryption backend is injected by the shell (or standalone
// server entry) via `configureSecretStore` so this module has no
// electron imports and can run in a pure Node process.
//
// Backend: a random AES-256 key stored at `<userDataDir>/secret.key`
// (mode 0600) alongside the sqlite DB, wrapped by `createAesSecretStore`.
// Both the Electron shell (embedded mode) and the standalone server
// (`server/bin.ts`) use the same file-based backend — we tried
// Electron's safeStorage for embedded mode but ad-hoc signed builds
// re-prompt the keychain on every launch, and a shared key file is the
// simpler story anyway.
//
// Ciphertexts are opaque base64 strings and always start with `wse1:`
// so the migration path can distinguish "already encrypted" from
// "legacy plaintext" cleanly.
// -----------------------------------------------------------------------------

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { log } from '../packages/logger'

export const SECRET_CIPHERTEXT_PREFIX = 'wse1:'

export interface SecretStore {
  readonly encrypt: (plaintext: string) => string
  readonly decrypt: (ciphertext: string) => string
}

let store: SecretStore | null = null

/**
 * Install a secret-store implementation. Must be called by the shell
 * (or standalone server entry) before any domain code touches encrypted
 * fields.
 */
export function configureSecretStore(impl: SecretStore): void {
  store = impl
}

/**
 * Encrypt a plaintext string to an opaque ciphertext. Output always
 * starts with `SECRET_CIPHERTEXT_PREFIX` so callers can identify
 * ciphertexts vs legacy plaintext.
 */
export function encryptSecret(plaintext: string): string {
  if (!store) {
    throw new Error('secret store not configured (call configureSecretStore first)')
  }
  if (plaintext.startsWith(SECRET_CIPHERTEXT_PREFIX)) {
    // Already encrypted — don't double-wrap.
    return plaintext
  }
  return store.encrypt(plaintext)
}

/**
 * Decrypt a ciphertext back to plaintext. Accepts legacy unprefixed
 * plaintexts transparently (returns them unchanged) so migrations
 * can run lazily at read time.
 */
export function decryptSecret(ciphertext: string): string {
  if (!store) {
    throw new Error('secret store not configured (call configureSecretStore first)')
  }
  if (!ciphertext.startsWith(SECRET_CIPHERTEXT_PREFIX)) {
    // Legacy plaintext — let the caller decide whether to re-save.
    return ciphertext
  }
  return store.decrypt(ciphertext)
}

/** True if `value` looks like a ciphertext produced by `encryptSecret`. */
export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(SECRET_CIPHERTEXT_PREFIX)
}

// -----------------------------------------------------------------------------
// Default AES-256-GCM backend (used by the standalone server entry).
//
// Not tied to Electron — plain Node crypto. The key is owned by the
// caller; this function just wraps it in the SecretStore interface.
// -----------------------------------------------------------------------------

export function createAesSecretStore(key: Buffer): SecretStore {
  if (key.length !== 32) {
    throw new Error(`AES secret store requires a 32-byte key, got ${key.length} bytes`)
  }

  return {
    encrypt: (plaintext: string): string => {
      // Lazy-import crypto so this file stays safe to import from the
      // renderer bundle's type graph. The runtime call only happens in
      // the server-side path.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const crypto = require('node:crypto') as typeof import('node:crypto')
      const iv = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const authTag = cipher.getAuthTag()
      const payload = Buffer.concat([iv, authTag, encrypted])
      return SECRET_CIPHERTEXT_PREFIX + payload.toString('base64')
    },
    decrypt: (ciphertext: string): string => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const crypto = require('node:crypto') as typeof import('node:crypto')
      const payload = Buffer.from(ciphertext.slice(SECRET_CIPHERTEXT_PREFIX.length), 'base64')
      if (payload.length < 12 + 16) {
        throw new Error('invalid ciphertext: payload too short')
      }
      const iv = payload.subarray(0, 12)
      const authTag = payload.subarray(12, 28)
      const encrypted = payload.subarray(28)
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
      return decrypted.toString('utf8')
    },
  }
}

/**
 * Load (or generate) the AES-256 key used to encrypt at-rest secrets.
 * Stored at `keyPath` with mode 0600. Creates the parent directory if
 * missing. Returns the raw key bytes ready for `createAesSecretStore`.
 */
export function loadOrCreateSecretKey(keyPath: string): Buffer {
  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath)
    if (key.length === 32) return key
    log.main.warn(`${keyPath}: invalid key length, regenerating`)
  }
  const dir = dirname(keyPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('node:crypto') as typeof import('node:crypto')
  const key = crypto.randomBytes(32)
  writeFileSync(keyPath, key, { mode: 0o600 })
  try {
    chmodSync(keyPath, 0o600)
  } catch {
    // best-effort on filesystems that don't honor mode bits
  }
  log.main.info(`generated new secret key at ${keyPath}`)
  return key
}
