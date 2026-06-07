import { createContext, useContext } from 'react'
import type { SettingsFormApi } from './use-settings-form'

const SettingsFormContext = createContext<SettingsFormApi | null>(null)

export const SettingsFormProvider = SettingsFormContext.Provider

export function useSettingsFormContext(): SettingsFormApi {
  const ctx = useContext(SettingsFormContext)
  if (!ctx) throw new Error('useSettingsFormContext must be used within SettingsFormProvider')
  return ctx
}
