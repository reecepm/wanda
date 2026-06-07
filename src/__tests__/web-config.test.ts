import { describe, expect, it } from 'vitest'
import { buildConfig, parseStoredConfig, readConfigFromUrl } from '../web-config'

describe('buildConfig', () => {
  it('strips trailing slash from server URL', () => {
    const config = buildConfig('http://127.0.0.1:9191/', 'abcd1234')
    expect(config.httpUrl).toBe('http://127.0.0.1:9191')
  })

  it('derives ws URL from http URL', () => {
    expect(buildConfig('http://127.0.0.1:9191', 't').wsUrl).toBe('ws://127.0.0.1:9191/events')
    expect(buildConfig('https://wanda.example.com', 't').wsUrl).toBe('wss://wanda.example.com/events')
  })

  it('preserves the token unchanged', () => {
    expect(buildConfig('http://x', 'hex-token').token).toBe('hex-token')
  })
})

describe('readConfigFromUrl', () => {
  it('returns null when server is missing', () => {
    expect(readConfigFromUrl('http://app.local/web.html?token=abc')).toBeNull()
  })

  it('returns null when token is missing', () => {
    expect(readConfigFromUrl('http://app.local/web.html?server=http://127.0.0.1:9191')).toBeNull()
  })

  it('returns null when both are missing', () => {
    expect(readConfigFromUrl('http://app.local/web.html')).toBeNull()
  })

  it('builds a config when both params are present', () => {
    const config = readConfigFromUrl('http://app.local/web.html?server=http://127.0.0.1:9191&token=hex')
    expect(config).toEqual({
      httpUrl: 'http://127.0.0.1:9191',
      wsUrl: 'ws://127.0.0.1:9191/events',
      token: 'hex',
    })
  })
})

describe('parseStoredConfig', () => {
  it('returns null for null input', () => {
    expect(parseStoredConfig(null)).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseStoredConfig('not json')).toBeNull()
  })

  it('returns null for missing fields', () => {
    expect(parseStoredConfig(JSON.stringify({ httpUrl: 'http://x' }))).toBeNull()
    expect(parseStoredConfig(JSON.stringify({ httpUrl: 'http://x', wsUrl: 'ws://x' }))).toBeNull()
  })

  it('returns null for wrong types', () => {
    expect(parseStoredConfig(JSON.stringify({ httpUrl: 123, wsUrl: 'ws://x', token: 't' }))).toBeNull()
  })

  it('returns a valid config for a complete object', () => {
    const raw = JSON.stringify({
      httpUrl: 'http://127.0.0.1:9191',
      wsUrl: 'ws://127.0.0.1:9191/events',
      token: 'abc',
    })
    expect(parseStoredConfig(raw)).toEqual({
      httpUrl: 'http://127.0.0.1:9191',
      wsUrl: 'ws://127.0.0.1:9191/events',
      token: 'abc',
    })
  })
})
