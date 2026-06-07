// Client-side validation of a user-pasted pairing URL.
//
// The authoritative parser lives in `electron/services/pairing-url.ts` —
// this is just a lightweight sanity check that runs synchronously in the
// renderer so the Pair button can disable itself on bad input without a
// round-trip to the main process.

export type PairingUrlError = 'empty' | 'not-a-url' | 'wrong-scheme' | 'missing-token'

export function validatePairingUrl(input: string): PairingUrlError | null {
  if (!input || !input.trim()) return 'empty'
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return 'not-a-url'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'wrong-scheme'

  // Token can be in #token= or ?token=.
  const fragmentToken = url.hash.length > 1 ? new URLSearchParams(url.hash.slice(1)).get('token') : null
  const queryToken = url.searchParams.get('token')
  if (!fragmentToken && !queryToken) return 'missing-token'
  return null
}

export function pairingUrlErrorMessage(err: PairingUrlError): string {
  switch (err) {
    case 'empty':
      return 'Paste a pairing URL from the server’s startup output.'
    case 'not-a-url':
      return 'That doesn’t look like a URL.'
    case 'wrong-scheme':
      return 'Pairing URLs must start with http:// or https://.'
    case 'missing-token':
      return 'The URL is missing a #token=… fragment.'
  }
}
