import { describe, expect, it } from 'vitest'
import { isMissingExecutableError } from './index'

describe('isMissingExecutableError', () => {
  it('recognizes missing executable errors by code', () => {
    expect(isMissingExecutableError(Object.assign(new Error('spawn gt ENOENT'), { code: 'ENOENT' }))).toBe(true)
  })

  it('does not treat ordinary command failures as missing binaries', () => {
    expect(isMissingExecutableError(Object.assign(new Error('gt failed'), { code: 1 }))).toBe(false)
  })
})
