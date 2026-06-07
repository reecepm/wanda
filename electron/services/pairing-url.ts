// -----------------------------------------------------------------------------
// Pairing URL parser.
//
// Canonical form printed by `wanda-server`:
//
//   http://<host>:<port>/pair#token=<hex>
//
// We also tolerate `?token=` on the query string because QR scanners and
// some clipboards drop fragments. The return is normalized to
// `{ baseUrl, pairingToken }` — `baseUrl` is the server root (no trailing
// path or slash), suitable for concatenating `/api/auth/bootstrap` etc.
// -----------------------------------------------------------------------------

export interface ParsedPairingUrl {
  readonly baseUrl: string
  readonly pairingToken: string
}

export function parsePairingUrl(input: string): ParsedPairingUrl | null {
  if (!input || typeof input !== 'string') return null
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  // Token comes from the fragment first, then query.
  let token: string | null = null
  if (url.hash && url.hash.length > 1) {
    const params = new URLSearchParams(url.hash.slice(1))
    const t = params.get('token')
    if (t) token = t
  }
  if (!token) {
    const t = url.searchParams.get('token')
    if (t) token = t
  }
  if (!token) return null

  const baseUrl = `${url.protocol}//${url.host}`
  return { baseUrl, pairingToken: token }
}
