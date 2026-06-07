export type LocaleEnv = Record<string, string | undefined>

export function defaultUtf8Locale(platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8'
}

export function isUtf8Locale(value: string | undefined): boolean {
  return typeof value === 'string' && /utf-?8/i.test(value)
}

function isPosixLocale(value: string | undefined): boolean {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toUpperCase()
  return normalized === 'C' || normalized === 'POSIX'
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined
}

export function ensureUtf8Locale<T extends LocaleEnv>(env: T, platform: NodeJS.Platform = process.platform): T {
  const mutableEnv = env as LocaleEnv
  const fallback = defaultUtf8Locale(platform)
  const lcAll = nonEmpty(mutableEnv['LC_ALL'])

  if (lcAll) {
    if (isUtf8Locale(lcAll)) return env
    if (isPosixLocale(lcAll)) {
      mutableEnv['LC_ALL'] = fallback
      if (!nonEmpty(mutableEnv['LANG'])) mutableEnv['LANG'] = fallback
    }
    return env
  }

  const lcCtype = nonEmpty(mutableEnv['LC_CTYPE'])
  if (lcCtype) {
    if (isUtf8Locale(lcCtype)) return env
    if (isPosixLocale(lcCtype)) {
      mutableEnv['LC_CTYPE'] = fallback
      if (!nonEmpty(mutableEnv['LANG'])) mutableEnv['LANG'] = fallback
    }
    return env
  }

  const lang = nonEmpty(mutableEnv['LANG'])
  if (lang) {
    if (isUtf8Locale(lang)) return env
    if (isPosixLocale(lang)) mutableEnv['LC_CTYPE'] = fallback
    return env
  }

  mutableEnv['LANG'] = fallback
  return env
}
