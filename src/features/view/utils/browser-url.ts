export function isWandaRendererUrl(rawUrl: string, rendererHref: string = globalThis.location?.href ?? ''): boolean {
  if (!rawUrl.trim()) return false

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol === 'file:') {
    if (url.hash.startsWith('#/')) {
      const path = decodeURIComponent(url.pathname)
      return path.endsWith('/renderer/index.html') || path.includes('/app.asar/out/renderer/index.html')
    }
    return false
  }

  if (!rendererHref) return false

  try {
    const rendererUrl = new URL(rendererHref)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === rendererUrl.origin &&
      url.hash.startsWith('#/')
    )
  } catch {
    return false
  }
}

export function sanitizeBrowserUrl(rawUrl: string, rendererHref?: string): string {
  return isWandaRendererUrl(rawUrl, rendererHref) ? '' : rawUrl
}
