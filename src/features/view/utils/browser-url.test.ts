import { describe, expect, it } from 'vitest'
import { isWandaRendererUrl, sanitizeBrowserUrl } from './browser-url'

describe('browser-url guards', () => {
  it('drops packaged Wanda renderer hash routes', () => {
    const url =
      'file:///Users/example/Documents/personal/wanda/release/mac-arm64/Wanda.app/Contents/Resources/app.asar/out/renderer/index.html#/pods/7ea31b8f-9af8-414a-bece-c204d31705f2'

    expect(isWandaRendererUrl(url)).toBe(true)
    expect(sanitizeBrowserUrl(url)).toBe('')
  })

  it('drops dev renderer hash routes on the current origin', () => {
    expect(sanitizeBrowserUrl('http://localhost:5173/#/pods/p1', 'http://localhost:5173/#/pods/p2')).toBe('')
  })

  it('keeps ordinary web URLs', () => {
    expect(sanitizeBrowserUrl('https://example.com/#/pods/p1')).toBe('https://example.com/#/pods/p1')
    expect(sanitizeBrowserUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('keeps non-renderer file URLs', () => {
    expect(sanitizeBrowserUrl('file:///Users/example/Downloads/report.html')).toBe(
      'file:///Users/example/Downloads/report.html',
    )
  })
})
