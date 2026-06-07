import { describe, expect, it } from 'vitest'
import { pairingUrlErrorMessage, validatePairingUrl } from '../validate-pairing-url'

describe('validatePairingUrl', () => {
  it('accepts a canonical pairing URL with #token=', () => {
    expect(validatePairingUrl('http://example-host:9876/pair#token=abc')).toBeNull()
  })

  it('accepts ?token= as well', () => {
    expect(validatePairingUrl('http://127.0.0.1:9876/pair?token=xxx')).toBeNull()
  })

  it('accepts https', () => {
    expect(validatePairingUrl('https://server/pair#token=abc')).toBeNull()
  })

  it('trims whitespace', () => {
    expect(validatePairingUrl('   https://server/pair#token=abc  ')).toBeNull()
  })

  it('rejects empty / whitespace input', () => {
    expect(validatePairingUrl('')).toBe('empty')
    expect(validatePairingUrl('   ')).toBe('empty')
  })

  it('rejects malformed URLs', () => {
    expect(validatePairingUrl('not a url')).toBe('not-a-url')
    // `htp://broken` parses — bare word, custom scheme — so it lands in wrong-scheme, not not-a-url.
    expect(validatePairingUrl('://missing-scheme')).toBe('not-a-url')
  })

  it('rejects non-HTTP schemes', () => {
    expect(validatePairingUrl('ws://host/pair#token=abc')).toBe('wrong-scheme')
    expect(validatePairingUrl('ftp://host/pair#token=abc')).toBe('wrong-scheme')
  })

  it('rejects URLs without a token', () => {
    expect(validatePairingUrl('http://host:9876/pair')).toBe('missing-token')
    expect(validatePairingUrl('http://host:9876/pair#')).toBe('missing-token')
    expect(validatePairingUrl('http://host:9876/pair?foo=bar')).toBe('missing-token')
  })

  it('has a message for every error code', () => {
    const codes = ['empty', 'not-a-url', 'wrong-scheme', 'missing-token'] as const
    for (const code of codes) {
      expect(typeof pairingUrlErrorMessage(code)).toBe('string')
      expect(pairingUrlErrorMessage(code).length).toBeGreaterThan(0)
    }
  })
})
