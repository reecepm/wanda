import type { StoreApi } from 'zustand'
import { orpcUtils } from '@/shared/orpc'

type StoreWithSelector<T> = StoreApi<T> & {
  subscribe: {
    (listener: (state: T, previousState: T) => void): () => void
    <U>(selector: (state: T) => U, listener: (selectedState: U, previousSelectedState: U) => void): () => void
  }
}

/**
 * One persisted key in the config list. The mapped-union shape preserves
 * contextual typing for each `storeKey`, so a serializer for a boolean key
 * sees a boolean and a serializer for a string-list key sees a string array.
 */
type PersistedKey<T> = {
  [K in keyof T & string]: {
    /** Key in the Zustand store state */
    storeKey: K
    /** Key used in the settings DB */
    settingKey: string
    /** Convert store value to a string for persistence. Defaults to identity (assumes string | null). */
    serialize?: (value: T[K]) => string | null
    /** Convert persisted string back to a store value. Defaults to identity. */
    deserialize?: (value: string) => T[K]
  }
}[keyof T & string]

interface PersistenceConfig<T> {
  keys: PersistedKey<T>[]
  /** Debounce interval in ms. Defaults to 500. */
  debounceMs?: number
}

interface PersistenceHandle {
  /** Restore persisted values into the store. Call once at startup. */
  restore: () => Promise<void>
  /** Tear down subscriptions and event listeners. */
  destroy: () => void
}

/**
 * Wire up debounced settings persistence for a Zustand store that uses
 * `subscribeWithSelector` and has a boolean `restored` flag.
 *
 * Handles:
 * - Per-key debounced writes via the settings API
 * - Guarding writes until `restored === true`
 * - Flushing pending writes on `beforeunload`
 * - Restoring values from the settings API into the store
 */
export function createSettingsPersistence<T extends { restored: boolean }>(
  store: StoreWithSelector<T>,
  config: PersistenceConfig<T>,
): PersistenceHandle {
  const debounceMs = config.debounceMs ?? 500
  const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}

  function serializeKey<K extends keyof T & string>(
    key: Extract<PersistedKey<T>, { storeKey: K }>,
    state: T,
  ): string | null {
    return key.serialize ? key.serialize(state[key.storeKey]) : (state[key.storeKey] as string | null)
  }

  function deserializeKey<K extends keyof T & string>(
    key: Extract<PersistedKey<T>, { storeKey: K }>,
    raw: string,
  ): T[K] {
    return key.deserialize ? (key.deserialize(raw) as T[K]) : (raw as T[K])
  }

  const unsubscribers: (() => void)[] = []

  for (const key of config.keys) {
    const unsub = store.subscribe(
      (s: T) => s[key.storeKey],
      () => {
        if (!store.getState().restored) return
        clearTimeout(debounceTimers[key.settingKey])
        debounceTimers[key.settingKey] = setTimeout(() => {
          orpcUtils.settings.set
            .call({ key: key.settingKey, value: serializeKey(key, store.getState()) })
            .catch((err) => {
              console.error(`[store-persistence] settings.set failed for ${key.settingKey}:`, err)
            })
        }, debounceMs)
      },
    )
    unsubscribers.push(unsub)
  }

  function flush() {
    for (const k of Object.keys(debounceTimers)) clearTimeout(debounceTimers[k])
    const state = store.getState()
    for (const key of config.keys) {
      const value = serializeKey(key, state)
      orpcUtils.settings.set.call({ key: key.settingKey, value }).catch((err) => {
        // Renderer is on its way out; error is mostly interesting in DevTools.
        console.error(`[store-persistence] flush settings.set failed for ${key.settingKey}:`, err)
      })
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flush)
  }

  async function restore() {
    try {
      const settingKeys = config.keys.map((k) => k.settingKey)
      const values = await orpcUtils.settings.getMany.call({ keys: settingKeys })

      const patch: Partial<T> = {}
      for (const key of config.keys) {
        const raw = values[key.settingKey]
        if (raw != null) {
          patch[key.storeKey as keyof T] = deserializeKey(key, raw) as T[keyof T]
        }
      }
      store.setState({ ...patch, restored: true } as Partial<T> & { restored: true })
    } catch {
      store.setState({ restored: true } as Partial<T> & { restored: true })
    }
  }

  function destroy() {
    for (const unsub of unsubscribers) unsub()
    for (const k of Object.keys(debounceTimers)) clearTimeout(debounceTimers[k])
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', flush)
    }
  }

  return { restore, destroy }
}
