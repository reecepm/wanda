// -----------------------------------------------------------------------------
// Pairing URL parser tests.
//
// The URL shape the server prints on startup is
//
//   http://<host>:<port>/pair#token=<hex>
//
// ...but we want to be tolerant: users paste from different sources (QR
// scan, terminal copy, sometimes a `?token=` variant). The parser
// normalizes to `{ baseUrl, pairingToken }` or null.
// -----------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { parsePairingUrl } from '../pairing-url'

describe('parsePairingUrl', () => {
  it('parses the canonical #token= form', () => {
    const result = parsePairingUrl('http://example-host:9876/pair#token=abc123def')
    expect(result).not.toBeNull()
    expect(result!.baseUrl).toBe('http://example-host:9876')
    expect(result!.pairingToken).toBe('abc123def')
  })

  it('accepts https', () => {
    const result = parsePairingUrl('https://server.example.com/pair#token=xyz')
    expect(result!.baseUrl).toBe('https://server.example.com')
    expect(result!.pairingToken).toBe('xyz')
  })

  it('tolerates the ?token= query-string form', () => {
    const result = parsePairingUrl('http://127.0.0.1:9876/pair?token=qqq')
    expect(result!.pairingToken).toBe('qqq')
    expect(result!.baseUrl).toBe('http://127.0.0.1:9876')
  })

  it('returns null for URLs missing a token', () => {
    expect(parsePairingUrl('http://127.0.0.1:9876/pair')).toBeNull()
    expect(parsePairingUrl('http://127.0.0.1:9876/pair#')).toBeNull()
  })

  it('returns null for non-HTTP(S) schemes', () => {
    expect(parsePairingUrl('ws://127.0.0.1:9876/pair#token=abc')).toBeNull()
    expect(parsePairingUrl('ftp://server/pair#token=abc')).toBeNull()
  })

  it('returns null for malformed input', () => {
    expect(parsePairingUrl('not a url')).toBeNull()
    expect(parsePairingUrl('')).toBeNull()
  })

  it('strips trailing slashes from the base URL', () => {
    const result = parsePairingUrl('http://host:9876/pair/#token=abc')
    expect(result!.baseUrl).toBe('http://host:9876')
  })

  it('preserves non-standard ports', () => {
    const result = parsePairingUrl('http://host:12345/pair#token=abc')
    expect(result!.baseUrl).toBe('http://host:12345')
  })
})
