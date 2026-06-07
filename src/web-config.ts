// -----------------------------------------------------------------------------
// Web-entry config helpers.
//
// Pure functions that derive a server connection config from URL query
// params, sessionStorage, or explicit inputs. Extracted from `web-entry.ts`
// so they can be unit-tested without a DOM.
// -----------------------------------------------------------------------------

export interface WebConfig {
  readonly httpUrl: string
  readonly wsUrl: string
  readonly token: string
}

export const CONFIG_STORAGE_KEY = 'wanda:web-config'

/**
 * Normalize a user-supplied HTTP URL + token into a full WebConfig. Strips
 * trailing slashes and derives the WS URL from the HTTP URL.
 */
export function buildConfig(serverUrl: string, token: string): WebConfig {
  const normalized = serverUrl.replace(/\/$/, '')
  const wsBase = normalized.replace(/^http/, 'ws')
  return {
    httpUrl: normalized,
    wsUrl: `${wsBase}/events`,
    token,
  }
}

/**
 * Read config from URL query params. Returns null if either `server` or
 * `token` is missing. Does NOT mutate storage.
 */
export function readConfigFromUrl(url: string): WebConfig | null {
  const parsed = new URL(url)
  const server = parsed.searchParams.get('server')
  const token = parsed.searchParams.get('token')
  if (!server || !token) return null
  return buildConfig(server, token)
}

/**
 * Parse a stored JSON config, returning null (and clearing storage) if
 * the value is malformed.
 */
export function parseStoredConfig(raw: string | null): WebConfig | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<WebConfig>
    if (typeof parsed.httpUrl !== 'string') return null
    if (typeof parsed.wsUrl !== 'string') return null
    if (typeof parsed.token !== 'string') return null
    return { httpUrl: parsed.httpUrl, wsUrl: parsed.wsUrl, token: parsed.token }
  } catch {
    return null
  }
}
