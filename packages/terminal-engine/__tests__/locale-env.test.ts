import { describe, expect, it } from 'vitest'
import { ensureUtf8Locale } from '../src/locale-env.js'

describe('ensureUtf8Locale', () => {
  it('backfills LANG when no locale is present', () => {
    expect(ensureUtf8Locale({}, 'darwin')).toEqual({ LANG: 'en_US.UTF-8' })
  })

  it('uses C.UTF-8 outside macOS', () => {
    expect(ensureUtf8Locale({}, 'linux')).toEqual({ LANG: 'C.UTF-8' })
  })

  it('adds a UTF-8 character locale when LANG is C', () => {
    expect(ensureUtf8Locale({ LANG: 'C' }, 'darwin')).toEqual({
      LANG: 'C',
      LC_CTYPE: 'en_US.UTF-8',
    })
  })

  it('replaces LC_ALL when it forces the C locale', () => {
    expect(ensureUtf8Locale({ LC_ALL: 'POSIX', LANG: 'C' }, 'linux')).toEqual({
      LC_ALL: 'C.UTF-8',
      LANG: 'C',
    })
  })

  it('leaves existing UTF-8 locales alone', () => {
    expect(ensureUtf8Locale({ LANG: 'en_GB.UTF-8' }, 'darwin')).toEqual({ LANG: 'en_GB.UTF-8' })
    expect(ensureUtf8Locale({ LC_CTYPE: 'UTF-8', LANG: 'C' }, 'darwin')).toEqual({
      LC_CTYPE: 'UTF-8',
      LANG: 'C',
    })
  })
})
