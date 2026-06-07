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
  // Generic `T extends LocaleEnv` lets callers preserve their concrete env
  // type (e.g. `NodeJS.ProcessEnv`). Writes need an unsoundness escape via the
  // base type because TS won't let us assign to a key of an unknown subtype.
  const writable = env as LocaleEnv
  const fallback = defaultUtf8Locale(platform)
  const lcAll = nonEmpty(writable.LC_ALL)

  if (lcAll) {
    if (isUtf8Locale(lcAll)) return env
    if (isPosixLocale(lcAll)) {
      writable.LC_ALL = fallback
      if (!nonEmpty(writable.LANG)) writable.LANG = fallback
    }
    return env
  }

  const lcCtype = nonEmpty(writable.LC_CTYPE)
  if (lcCtype) {
    if (isUtf8Locale(lcCtype)) return env
    if (isPosixLocale(lcCtype)) {
      writable.LC_CTYPE = fallback
      if (!nonEmpty(writable.LANG)) writable.LANG = fallback
    }
    return env
  }

  const lang = nonEmpty(writable.LANG)
  if (lang) {
    if (isUtf8Locale(lang)) return env
    if (isPosixLocale(lang)) writable.LC_CTYPE = fallback
    return env
  }

  writable.LANG = fallback
  return env
}
